//! Versioned, finite-context restoration. All coordinates are source-origin frames.
use crate::spectral::{Layer, Shape};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Processor {
    NoiseReduction {
        #[serde(rename = "profileDb")]
        profile_db: Vec<f64>,
        #[serde(rename = "reductionDb")]
        reduction_db: f64,
        #[serde(rename = "sensitivityDb")]
        sensitivity_db: f64,
    },
    SpectralGate {
        #[serde(rename = "thresholdDb")]
        threshold_db: f64,
        #[serde(rename = "reductionDb")]
        reduction_db: f64,
    },
    Hum {
        frequency: f64,
        #[serde(rename = "widthHz")]
        width_hz: f64,
        #[serde(rename = "reductionDb")]
        reduction_db: f64,
    },
    Interpolate,
    NeuralSpeechV1 {
        strength: f64,
    },
}
impl Layer {
    pub fn active(&self) -> bool {
        self.enabled
            && match self.processor {
                None => self.gain_db != 0.0,
                Some(
                    Processor::SpectralGate { reduction_db, .. }
                    | Processor::Hum { reduction_db, .. }
                    | Processor::NoiseReduction { reduction_db, .. },
                ) => reduction_db != 0.0,
                Some(Processor::NeuralSpeechV1 { strength }) => strength != 0.0,
                Some(Processor::Interpolate) => true,
            }
    }
}
pub fn render_halo(layers: &[Layer]) -> u64 {
    2048 + layers
        .iter()
        .filter(|l| l.active())
        .map(|l| match l.processor {
            Some(Processor::NeuralSpeechV1 { .. }) => 120480,
            _ => 2048,
        })
        .sum::<u64>()
}
pub fn validate_processor(layer: &Layer, rate: u32, channels: u16) -> Result<(), String> {
    let finite = |v: f64, a: f64, b: f64| v.is_finite() && (a..=b).contains(&v);
    match layer.processor {
        None => (),
        Some(Processor::NoiseReduction {
            ref profile_db,
            reduction_db,
            sensitivity_db,
        }) => {
            if profile_db.len() != 1025 * channels as usize
                || !profile_db.iter().all(|v| finite(*v, -240.0, 120.0))
                || !finite(reduction_db, 0.0, 60.0)
                || !finite(sensitivity_db, -12.0, 24.0)
            {
                return Err("Noise reduction requires a valid per-channel 2048-point noise profile, reduction 0…60 dB and sensitivity −12…24 dB.".into());
            }
        }
        Some(Processor::SpectralGate {
            threshold_db,
            reduction_db,
        }) => {
            if !finite(threshold_db, -120.0, 0.0) || !finite(reduction_db, 0.0, 60.0) {
                return Err(
                    "Spectral gate requires threshold −120…0 dBFS and reduction 0…60 dB.".into(),
                );
            }
        }
        Some(Processor::Hum {
            frequency,
            width_hz,
            reduction_db,
        }) => {
            if !finite(frequency, 20.0, 200.0)
                || !finite(width_hz, rate as f64 / 2048.0, 200.0)
                || !finite(reduction_db, 0.0, 60.0)
            {
                return Err("Invalid hum frequency, FFT-bin width or reduction.".into());
            }
        }
        Some(Processor::Interpolate | Processor::NeuralSpeechV1 { .. }) => {
            let Shape::Rectangle {
                start,
                end,
                low,
                high,
            } = layer.mask.shape
            else {
                return Err(
                    "This restoration requires a full-band rectangular time selection.".into(),
                );
            };
            if low != 0.0
                || high != rate as f64 / 2.0
                || layer.mask.feather_hz != 0.0
                || start.fract() != 0.0
                || end.fract() != 0.0
            {
                return Err(
                    "Time restoration requires integer sample bounds and the full frequency band."
                        .into(),
                );
            }
            if matches!(layer.processor, Some(Processor::Interpolate))
                && (end - start > rate as f64 * 0.01
                    || start < 1.0
                    || layer.mask.feather_time != 0.0)
            {
                return Err("Interpolation requires a region of at most 10 ms, with a sample before it and no feather.".into());
            }
            if let Some(Processor::NeuralSpeechV1 { strength }) = layer.processor {
                if rate != 48000 || !finite(strength, 0.0, 1.0) {
                    return Err(
                        "Offline neural speech denoising supports 48 kHz audio and strength 0…1."
                            .into(),
                    );
                }
            }
        }
    }
    Ok(())
}
pub fn interpolate(input: &[f64], global: i64, channels: usize, layer: &Layer) -> Vec<f64> {
    let mut out = input.to_vec();
    let Shape::Rectangle { start, end, .. } = layer.mask.shape else {
        return out;
    };
    let a = start as i64 - global;
    let b = end as i64 - global;
    let frames = input.len() as i64 / channels as i64;
    // Halo guarantees both endpoints for all requested output samples. At source end reject in validation.
    if a < 1 || b >= frames {
        return out;
    }
    for ch in 0..channels {
        if layer.mask.channel.is_some_and(|c| c as usize != ch) {
            continue;
        }
        let left = input[(a as usize - 1) * channels + ch];
        let right = input[b as usize * channels + ch];
        for t in a..b {
            let q = (t - a + 1) as f64 / (b - a + 1) as f64;
            out[t as usize * channels + ch] = left + q * (right - left);
        }
    }
    out
}
/// Fixed 2 s blocks, 1 s hop, 0.5 s warm-up, periodic Hann crossfade.
/// This explicit finite-context algorithm yields identical crops regardless of export/preview chunking.
/// RNNoise's 480-sample delay is compensated. Source edges are zero extended.
pub fn neural(
    input: &[f64],
    global: i64,
    channels: usize,
    layer: &Layer,
    strength: f64,
) -> Vec<f64> {
    const BLOCK: i64 = 96000;
    const HOP: i64 = 48000;
    const WARM: i64 = 24000;
    const FRAME: i64 = 480;
    let frames = input.len() / channels;
    let (low, high) = layer.mask.time_bounds();
    let first_sample = global.max(low.floor() as i64);
    let last_sample = (global + frames as i64).min(high.ceil() as i64);
    if last_sample <= first_sample {
        return input.to_vec();
    }
    let first = first_sample.div_euclid(HOP) - 1;
    let last = (last_sample - 1).div_euclid(HOP);
    let mut delta = vec![0.0; input.len()];
    for m in first..=last {
        let block_start = m * HOP;
        for ch in 0..channels {
            if layer.mask.channel.is_some_and(|c| c as usize != ch) {
                continue;
            }
            let mut state = nnnoiseless::DenoiseState::new();
            let mut x = [0.0f32; 480];
            let mut y = [0.0f32; 480];
            let mut t = block_start - WARM;
            while t < block_start + BLOCK + FRAME {
                for (j, v) in x.iter_mut().enumerate() {
                    let local = t + j as i64 - global;
                    *v = if (0..frames as i64).contains(&local) {
                        (input[local as usize * channels + ch].clamp(-1.0, 1.0) * 32768.0) as f32
                    } else {
                        0.0
                    };
                }
                state.process_frame(&mut y, &x);
                let aligned = t - FRAME;
                for (j, value) in y.iter().enumerate() {
                    let at = aligned + j as i64;
                    if at < block_start
                        || at >= block_start + BLOCK
                        || at < first_sample
                        || at >= last_sample
                    {
                        continue;
                    }
                    let local = (at - global) as usize * channels + ch;
                    let weight =
                        0.5 - 0.5 * (2.0 * PI * (at - block_start) as f64 / BLOCK as f64).cos();
                    let mask = layer.mask.weight(at as f64, 0.0, ch as u16);
                    delta[local] +=
                        (f64::from(*value) / 32768.0 - input[local]) * weight * strength * mask;
                }
                t += FRAME;
            }
        }
    }
    input.iter().zip(delta).map(|(a, b)| a + b).collect()
}
