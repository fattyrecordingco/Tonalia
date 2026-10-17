use rustfft::{num_complex::Complex, Fft, FftPlanner};
use serde::{Deserialize, Serialize};
use std::{f64::consts::PI, sync::Arc};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Point {
    pub sample: f64,
    pub hz: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Shape {
    Composite {
        operations: Vec<SelectionOperation>,
    },
    Rectangle {
        start: f64,
        end: f64,
        low: f64,
        high: f64,
    },
    Polygon {
        points: Vec<Point>,
    },
    Brush {
        points: Vec<Point>,
        #[serde(rename = "radiusTime")]
        radius_time: f64,
        #[serde(rename = "radiusHz")]
        radius_hz: f64,
        opacity: f64,
        /// Absent in legacy projects, which retain their original accumulated dabs.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hardness: Option<f64>,
    },
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectionMode {
    Add,
    Subtract,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SelectionOperation {
    pub mode: SelectionMode,
    pub mask: Mask,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    pub shape: Shape,
    pub channel: Option<u16>,
    pub feather_time: f64,
    pub feather_hz: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub gain_db: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processor: Option<crate::restoration::Processor>,
    pub mask: Mask,
}
fn ramp(distance: f64, width: f64) -> f64 {
    if distance >= 0.0 {
        1.0
    } else if width <= 0.0 {
        0.0
    } else {
        let x = (1.0 + distance / width).clamp(0.0, 1.0);
        x * x * (3.0 - 2.0 * x)
    }
}
impl Mask {
    pub fn time_bounds(&self) -> (f64, f64) {
        let (a, b) = match &self.shape {
            Shape::Composite { operations } => operations
                .iter()
                .filter(|op| matches!(op.mode, SelectionMode::Add))
                .map(|op| op.mask.time_bounds())
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), (c, d)| {
                    (a.min(c), b.max(d))
                }),
            Shape::Rectangle { start, end, .. } => (*start, *end),
            Shape::Polygon { points } => points
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                    (a.min(p.sample), b.max(p.sample))
                }),
            Shape::Brush {
                points,
                radius_time,
                ..
            } => {
                let (a, b) = points
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                        (a.min(p.sample), b.max(p.sample))
                    });
                (a - radius_time, b + radius_time)
            }
        };
        (a - self.feather_time, b + self.feather_time)
    }
    /// Evaluate a frame once, sharing geometry across channels. Brush primitives
    /// touch only FFT bins inside their time/frequency support; no point thinning.
    fn frame_weights(&self, t: f64, bin_hz: f64, weights: &mut [f64]) {
        let Shape::Brush {
            points,
            radius_time,
            radius_hz,
            opacity,
            hardness,
        } = &self.shape
        else {
            for (k, weight) in weights.iter_mut().enumerate() {
                *weight = self.weight(t, k as f64 * bin_hz, self.channel.unwrap_or(0));
            }
            return;
        };
        weights.fill(1.0);
        let bin_count = weights.len();
        let bins = |low: f64, high: f64| {
            let first = (low / bin_hz).ceil().max(0.0) as usize;
            let last = (high / bin_hz).floor().max(0.0) as usize;
            first.min(bin_count)..last.saturating_add(1).min(bin_count)
        };
        if let Some(hardness) = hardness {
            if let Some(first) = points.first() {
                for (a, b) in
                    std::iter::once((first, first)).chain(points.windows(2).map(|p| (&p[0], &p[1])))
                {
                    if t < a.sample.min(b.sample) - radius_time
                        || t > a.sample.max(b.sample) + radius_time
                    {
                        continue;
                    }
                    let range = bins(a.hz.min(b.hz) - radius_hz, a.hz.max(b.hz) + radius_hz);
                    let ax = (t - a.sample) / radius_time;
                    let bx = (t - b.sample) / radius_time;
                    let dx = bx - ax;
                    for k in range {
                        let f = k as f64 * bin_hz;
                        let ay = (f - a.hz) / radius_hz;
                        let by = (f - b.hz) / radius_hz;
                        let dy = by - ay;
                        let q =
                            (-(ax * dx + ay * dy) / (dx * dx + dy * dy).max(1e-20)).clamp(0.0, 1.0);
                        weights[k] = weights[k].min((ax + q * dx).hypot(ay + q * dy));
                    }
                }
            }
            for weight in weights {
                let q = ((1.0 - *weight) / (1.0 - hardness).max(1e-9)).clamp(0.0, 1.0);
                *weight = opacity * q * q * (3.0 - 2.0 * q);
            }
        } else {
            for p in points {
                if (t - p.sample).abs() > *radius_time {
                    continue;
                }
                for k in bins(p.hz - radius_hz, p.hz + radius_hz) {
                    let f = k as f64 * bin_hz;
                    let d = (((t - p.sample) / radius_time).powi(2)
                        + ((f - p.hz) / radius_hz).powi(2))
                    .sqrt();
                    if d < 1.0 {
                        let x = (1.0 - d).clamp(0.0, 1.0);
                        weights[k] *= 1.0 - opacity * x * x * (3.0 - 2.0 * x);
                    }
                }
            }
            for weight in weights {
                *weight = 1.0 - *weight;
            }
        }
    }

    // Allocate scratch once per rendered block, never once per stroke or FFT frame.
    fn channel_frame_weights(
        &self,
        t: f64,
        bin_hz: f64,
        channel: u16,
        weights: &mut [f64],
        scratch: &mut [f64],
    ) {
        if self.channel.is_some_and(|c| c != channel) {
            weights.fill(0.0);
            return;
        }
        if let Shape::Composite { operations } = &self.shape {
            weights.fill(0.0);
            for op in operations {
                if op.mask.channel.is_some_and(|c| c != channel) {
                    continue;
                }
                let (start, end) = op.mask.time_bounds();
                if t < start || t > end {
                    continue;
                }
                op.mask.frame_weights(t, bin_hz, scratch);
                for (w, value) in weights.iter_mut().zip(scratch.iter()) {
                    *w = match op.mode {
                        SelectionMode::Add => w.max(*value),
                        SelectionMode::Subtract => *w * (1.0 - value),
                    };
                }
            }
        } else {
            self.frame_weights(t, bin_hz, weights);
        }
    }
    fn channel_dependent(&self) -> bool {
        self.channel.is_some()
            || matches!(&self.shape, Shape::Composite { operations } if operations.iter().any(|op| op.mask.channel.is_some()))
    }

    pub fn weight(&self, t: f64, f: f64, channel: u16) -> f64 {
        if self.channel.is_some_and(|c| c != channel) {
            return 0.0;
        }
        match &self.shape {
            Shape::Composite { operations } => operations.iter().fold(0.0_f64, |w, op| {
                let value = op.mask.weight(t, f, channel);
                match op.mode {
                    SelectionMode::Add => w.max(value),
                    SelectionMode::Subtract => w * (1.0 - value),
                }
            }),
            Shape::Rectangle {
                start,
                end,
                low,
                high,
            } => {
                ramp((t - start).min(end - t), self.feather_time)
                    * ramp((f - low).min(high - f), self.feather_hz)
            }
            Shape::Polygon { points } => {
                let mut inside = false;
                let mut nearest = f64::INFINITY;
                let st = self.feather_time.max(1e-9);
                let sf = self.feather_hz.max(1e-9);
                let x = t / st;
                let y = f / sf;
                for (a, b) in points
                    .iter()
                    .zip(points.iter().cycle().skip(1))
                    .take(points.len())
                {
                    if (a.hz > f) != (b.hz > f)
                        && t < (b.sample - a.sample) * (f - a.hz) / (b.hz - a.hz) + a.sample
                    {
                        inside = !inside;
                    }
                    if self.feather_time > 0.0 || self.feather_hz > 0.0 {
                        let ax = a.sample / st;
                        let ay = a.hz / sf;
                        let dx = (b.sample - a.sample) / st;
                        let dy = (b.hz - a.hz) / sf;
                        let q = (((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy).max(1e-20))
                            .clamp(0.0, 1.0);
                        nearest = nearest
                            .min(((x - ax - q * dx).powi(2) + (y - ay - q * dy).powi(2)).sqrt());
                    }
                }
                if inside {
                    1.0
                } else {
                    ramp(-nearest, 1.0)
                }
            }
            Shape::Brush {
                points,
                radius_time,
                radius_hz,
                opacity,
                hardness,
            } => {
                if let Some(hardness) = hardness {
                    // Distance to a continuous stroke in physical sample/Hz coordinates.
                    // Taking the nearest segment makes opacity independent of event density.
                    let distance =
                        |p: &Point| ((t - p.sample) / radius_time, (f - p.hz) / radius_hz);
                    let (x, y) = distance(&points[0]);
                    let mut nearest = x.hypot(y);
                    for pair in points.windows(2) {
                        let (ax, ay) = distance(&pair[0]);
                        let (bx, by) = distance(&pair[1]);
                        let dx = bx - ax;
                        let dy = by - ay;
                        let q =
                            (-(ax * dx + ay * dy) / (dx * dx + dy * dy).max(1e-20)).clamp(0.0, 1.0);
                        nearest = nearest.min((ax + q * dx).hypot(ay + q * dy));
                    }
                    if nearest >= 1.0 {
                        return 0.0;
                    }
                    let q = ((1.0 - nearest) / (1.0 - hardness).max(1e-9)).clamp(0.0, 1.0);
                    return opacity * q * q * (3.0 - 2.0 * q);
                }
                // Smooth elliptical dabs. The persisted UI stroke includes interpolated points.
                let mut keep = 1.0;
                for p in points {
                    let d = (((t - p.sample) / radius_time).powi(2)
                        + ((f - p.hz) / radius_hz).powi(2))
                    .sqrt();
                    if d < 1.0 {
                        let x = (1.0 - d).clamp(0.0, 1.0);
                        keep *= 1.0 - opacity * x * x * (3.0 - 2.0 * x);
                    }
                }
                1.0 - keep
            }
        }
    }
}
pub fn validate_layers(
    layers: &[Layer],
    frames: u64,
    rate: u32,
    channels: u16,
) -> Result<(), String> {
    if layers.len() > 64 {
        return Err("This release supports at most 64 spectral layers.".into());
    }
    let mut ids = std::collections::HashSet::new();
    for l in layers {
        if !ids.insert(&l.id) {
            return Err("Spectral layer IDs must be unique.".into());
        }
        if l.id.is_empty()
            || l.id.len() > 128
            || l.name.len() > 200
            || !l.gain_db.is_finite()
            || !(-120.0..=24.0).contains(&l.gain_db)
        {
            return Err("Invalid spectral layer identity or gain (−120 to +24 dB).".into());
        }
        crate::restoration::validate_processor(l, rate, channels)?;
        if matches!(
            l.processor,
            Some(crate::restoration::Processor::Interpolate)
        ) && l.mask.time_bounds().1 >= frames as f64
        {
            return Err("Interpolation needs a source sample after the selection.".into());
        }
        if let Shape::Composite { operations } = &l.mask.shape {
            if operations.is_empty()
                || operations.len() > 128
                || !matches!(operations[0].mode, SelectionMode::Add)
                || l.mask.feather_time != 0.0
                || l.mask.feather_hz != 0.0
                || l.mask.channel.is_some_and(|c| c >= channels)
            {
                return Err(
                    "Invalid composite selection (1–128 operations, starting with an addition)."
                        .into(),
                );
            }
            let mut points = 0;
            for op in operations {
                validate_mask(&op.mask, frames, rate, channels)?;
                points += match &op.mask.shape {
                    Shape::Brush { points, .. } | Shape::Polygon { points } => points.len(),
                    _ => 0,
                };
            }
            if points > 32768 {
                return Err("A selection supports at most 32768 geometry points.".into());
            }
        } else {
            validate_mask(&l.mask, frames, rate, channels)?;
        }
    }

    if layers
        .iter()
        .filter(|l| {
            matches!(
                l.processor,
                Some(crate::restoration::Processor::NeuralSpeechV1 { .. })
            )
        })
        .count()
        > 1
    {
        return Err("This engine supports one neural speech layer per project.".into());
    }
    Ok(())
}
fn validate_mask(m: &Mask, frames: u64, rate: u32, channels: u16) -> Result<(), String> {
    let valid_point = |p: &Point| {
        p.sample.is_finite()
            && p.hz.is_finite()
            && p.sample >= 0.0
            && p.sample <= frames as f64
            && p.hz >= 0.0
            && p.hz <= rate as f64 / 2.0
    };

    if !m.feather_time.is_finite()
        || !m.feather_hz.is_finite()
        || !(0.0..=rate as f64).contains(&m.feather_time)
        || !(0.0..=rate as f64 / 2.0).contains(&m.feather_hz)
        || m.channel.is_some_and(|c| c >= channels)
    {
        return Err("Invalid mask feather or channel scope.".into());
    }
    match &m.shape {
        Shape::Composite { .. } => {
            return Err("Nested selection operations are not supported.".into())
        }
        Shape::Rectangle {
            start,
            end,
            low,
            high,
        } => {
            if !valid_point(&Point {
                sample: *start,
                hz: *low,
            }) || !valid_point(&Point {
                sample: *end,
                hz: *high,
            }) || start >= end
                || low >= high
            {
                return Err(
                    "Selection must have positive duration and bandwidth within the source.".into(),
                );
            }
        }
        Shape::Polygon { points } => {
            if points.len() < 3 || points.len() > 4096 || !points.iter().all(valid_point) {
                return Err("Invalid lasso geometry (3–4096 points).".into());
            }
        }
        Shape::Brush {
            points,
            radius_time,
            radius_hz,
            opacity,
            hardness,
        } => {
            if points.is_empty()
                || points.len() > 4096
                || !points.iter().all(valid_point)
                || !radius_time.is_finite()
                || !radius_hz.is_finite()
                || !opacity.is_finite()
                || !(1.0..=rate as f64 * 10.0).contains(radius_time)
                || !(0.01..=rate as f64 / 2.0).contains(radius_hz)
                || !(0.0..=1.0).contains(opacity)
                || hardness.is_some_and(|h| !h.is_finite() || !(0.0..=1.0).contains(&h))
            {
                return Err("Invalid brush geometry, size or opacity.".into());
            }
        }
    }
    Ok(())
}
pub struct Analyzer {
    n: usize,
    fft: Arc<dyn Fft<f64>>,
    inverse: Arc<dyn Fft<f64>>,
    window: Vec<f64>,
    buffer: Vec<Complex<f64>>,
    scratch: Vec<Complex<f64>>,
    coherent: f64,
}
impl Analyzer {
    pub fn new(n: usize) -> Result<Self, String> {
        if !n.is_power_of_two() || !(256..=16384).contains(&n) {
            return Err("FFT size must be a power of two between 256 and 16384.".into());
        }
        let mut p = FftPlanner::new();
        let fft = p.plan_fft_forward(n);
        let inverse = p.plan_fft_inverse(n);
        let scratch_len = fft
            .get_inplace_scratch_len()
            .max(inverse.get_inplace_scratch_len());
        let window: Vec<_> = (0..n)
            .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())
            .collect();
        let coherent = window.iter().sum();
        Ok(Self {
            n,
            fft,
            inverse,
            window,
            buffer: vec![Complex::default(); n],
            scratch: vec![Complex::default(); scratch_len],
            coherent,
        })
    }
    pub fn spectrum(
        &mut self,
        interleaved: &[f64],
        channels: usize,
        channel: usize,
    ) -> Result<Vec<f32>, String> {
        if channels == 0 || channel >= channels || interleaved.len() != self.n * channels {
            return Err("Spectrum input must contain exactly one FFT window.".into());
        }
        for i in 0..self.n {
            self.buffer[i] =
                Complex::new(interleaved[i * channels + channel] * self.window[i], 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.buffer, &mut self.scratch);
        Ok((0..=self.n / 2)
            .map(|k| {
                let factor = if k == 0 || k == self.n / 2 { 1.0 } else { 2.0 };
                (20.0
                    * (self.buffer[k].norm() * factor / self.coherent)
                        .max(1e-12)
                        .log10()) as f32
            })
            .collect())
    }
    /// Process deltas only: unselected samples remain bit-identical instead of accumulating no-op round-trip error.
    pub fn apply_layer(
        &mut self,
        input: &[f64],
        global_start: i64,
        channels: usize,
        rate: u32,
        layer: &Layer,
    ) -> Vec<f64> {
        if !layer.active() {
            return input.to_vec();
        }
        match layer.processor {
            Some(crate::restoration::Processor::Interpolate) => {
                return crate::restoration::interpolate(input, global_start, channels, layer)
            }
            Some(crate::restoration::Processor::NeuralSpeechV1 { strength }) => {
                return crate::restoration::neural(input, global_start, channels, layer, strength)
            }
            _ => (),
        }
        let frames = input.len() / channels;
        let hop = (self.n / 4) as i64;
        let half = (self.n / 2) as i64;
        let (low, high) = layer.mask.time_bounds();
        let block_end = global_start + frames as i64;
        if high + (half as f64) < global_start as f64 || low - (half as f64) > block_end as f64 {
            return input.to_vec();
        }
        let first =
            ((global_start - half).div_euclid(hop) + 1).max((low / hop as f64).ceil() as i64);
        let last = ((block_end + half - 1).div_euclid(hop)).min((high / hop as f64).floor() as i64);
        let mut out = input.to_vec();
        let gain = 10f64.powf(layer.gain_db / 20.0) - 1.0;
        // Periodic Hann squared at 75% overlap sums to 3/2, including zero-extended support frames.
        let normalization = 1.5 * self.n as f64;
        let mut mask_weights = vec![0.0; self.n / 2 + 1];
        let mut mask_scratch = vec![0.0; self.n / 2 + 1];
        let channel_dependent = layer.mask.channel_dependent();
        for m in first..=last {
            let center = m * hop;
            let start = center - half;
            for ch in 0..channels {
                if ch == 0 || channel_dependent {
                    layer.mask.channel_frame_weights(
                        center as f64,
                        rate as f64 / self.n as f64,
                        ch as u16,
                        &mut mask_weights,
                        &mut mask_scratch,
                    );
                }
                if mask_weights.iter().all(|w| *w == 0.0) {
                    continue;
                }
                for i in 0..self.n {
                    let local = start + i as i64 - global_start;
                    let v = if (0..frames as i64).contains(&local) {
                        input[local as usize * channels + ch]
                    } else {
                        0.0
                    };
                    self.buffer[i] = Complex::new(v * self.window[i], 0.0);
                }
                self.fft
                    .process_with_scratch(&mut self.buffer, &mut self.scratch);
                let mut changed = false;
                for k in 0..=self.n / 2 {
                    let delta_gain = match layer.processor {
                        Some(crate::restoration::Processor::NoiseReduction {
                            ref profile_db,
                            reduction_db,
                            sensitivity_db,
                        }) => {
                            let factor = if k == 0 || k == self.n / 2 { 1.0 } else { 2.0 };
                            let amplitude = self.buffer[k].norm() * factor / self.coherent;
                            // Profiles use the fixed processing FFT, independently of display FFT.
                            let profile_bin = (k * 2048 / self.n).min(1024);
                            let noise_power = 10f64.powf(
                                (profile_db[ch * 1025 + profile_bin] + sensitivity_db) / 10.0,
                            );
                            let floor = 10f64.powf(-reduction_db / 20.0);
                            (1.0 - noise_power / amplitude.powi(2).max(1e-30))
                                .max(floor * floor)
                                .sqrt()
                                - 1.0
                        }
                        Some(crate::restoration::Processor::SpectralGate {
                            threshold_db,
                            reduction_db,
                        }) => {
                            let factor = if k == 0 || k == self.n / 2 { 1.0 } else { 2.0 };
                            let db = 20.0
                                * (self.buffer[k].norm() * factor / self.coherent)
                                    .max(1e-15)
                                    .log10();
                            // Smooth 12 dB knee; no adaptive state or frame-order dependence.
                            let q = ((threshold_db + 6.0 - db) / 12.0).clamp(0.0, 1.0);
                            10f64.powf(-reduction_db * q * q * (3.0 - 2.0 * q) / 20.0) - 1.0
                        }
                        Some(crate::restoration::Processor::Hum {
                            frequency,
                            width_hz,
                            reduction_db,
                        }) => {
                            let hz = k as f64 * rate as f64 / self.n as f64;
                            let harmonic = (hz / frequency).round().max(1.0);
                            let q = (1.0 - (hz - harmonic * frequency).abs() / width_hz)
                                .clamp(0.0, 1.0);
                            10f64.powf(-reduction_db * q / 20.0) - 1.0
                        }
                        _ => gain,
                    };
                    let w = mask_weights[k] * delta_gain;
                    changed |= w != 0.0;
                    self.buffer[k] *= w;
                    if k > 0 && k < self.n / 2 {
                        self.buffer[self.n - k] = self.buffer[k].conj();
                    }
                }
                if !changed {
                    continue;
                }
                self.inverse
                    .process_with_scratch(&mut self.buffer, &mut self.scratch);
                for i in 0..self.n {
                    let local = start + i as i64 - global_start;
                    if (0..frames as i64).contains(&local) {
                        out[local as usize * channels + ch] +=
                            self.buffer[i].re * self.window[i] / normalization;
                    }
                }
            }
        }
        out
    }
}
/// Input must include N samples of halo per active layer on each side of the desired output.
/// Global frame alignment is source-origin based, so caller chunk sizes cannot move an edit.
pub fn render_layers(
    input: &[f64],
    global_start: i64,
    rate: u32,
    channels: usize,
    layers: &[Layer],
    fft_size: usize,
) -> Result<Vec<f64>, String> {
    if channels == 0
        || channels > 2
        || !input.len().is_multiple_of(channels)
        || input.iter().any(|x| !x.is_finite())
    {
        return Err("Invalid render input.".into());
    }
    if layers.iter().all(|l| !l.active()) {
        return Ok(input.to_vec());
    }
    let mut a = Analyzer::new(fft_size)?;
    let mut out = input.to_vec();
    for l in layers {
        out = a.apply_layer(&out, global_start, channels, rate, l);
    }
    if out.iter().any(|x| !x.is_finite()) {
        return Err("Processing produced nonfinite audio.".into());
    }
    Ok(out)
}

#[cfg(test)]
mod brush_frame_tests {
    use super::*;
    #[test]
    fn composite_frame_weights_match_scalar_across_channels_and_soft_edges() {
        let brush = |channel, opacity| Mask {
            shape: Shape::Brush {
                points: vec![
                    Point {
                        sample: 4000.0,
                        hz: 1200.0,
                    },
                    Point {
                        sample: 8000.0,
                        hz: 3400.0,
                    },
                ],
                radius_time: 1800.0,
                radius_hz: 700.0,
                opacity,
                hardness: Some(0.3),
            },
            channel,
            feather_time: 0.0,
            feather_hz: 0.0,
        };
        let mask = Mask {
            shape: Shape::Composite {
                operations: vec![
                    SelectionOperation {
                        mode: SelectionMode::Add,
                        mask: brush(None, 0.8),
                    },
                    SelectionOperation {
                        mode: SelectionMode::Subtract,
                        mask: brush(Some(0), 0.6),
                    },
                    SelectionOperation {
                        mode: SelectionMode::Add,
                        mask: Mask {
                            shape: Shape::Rectangle {
                                start: 5000.0,
                                end: 9000.0,
                                low: 1000.0,
                                high: 4000.0,
                            },
                            channel: Some(1),
                            feather_time: 200.0,
                            feather_hz: 100.0,
                        },
                    },
                ],
            },
            channel: None,
            feather_time: 0.0,
            feather_hz: 0.0,
        };
        for channel in 0..2 {
            for t in [0.0, 2199.0, 4000.0, 4900.0, 5100.0, 6000.0, 9000.0, 11000.0] {
                let mut weights = vec![0.0; 1025];
                let mut scratch = vec![0.0; 1025];
                mask.channel_frame_weights(
                    t,
                    48000.0 / 2048.0,
                    channel,
                    &mut weights,
                    &mut scratch,
                );
                for (k, w) in weights.iter().enumerate() {
                    assert!(
                        (w - mask.weight(t, k as f64 * 48000.0 / 2048.0, channel)).abs() < 1e-11,
                        "t={t} bin={k} ch={channel}"
                    );
                }
            }
        }
    }
    #[test]
    fn indexed_brush_matches_reference_without_changing_legacy_strokes() {
        for hardness in [None, Some(0.0), Some(0.5), Some(1.0)] {
            for points in [
                vec![Point {
                    sample: 4000.0,
                    hz: 1200.0,
                }],
                (0..70)
                    .map(|i| Point {
                        sample: 1000.0 + i as f64 * 130.0,
                        hz: 100.0 + (i as f64 * 0.61).sin().abs() * 22000.0,
                    })
                    .collect(),
            ] {
                let mask = Mask {
                    shape: Shape::Brush {
                        points,
                        radius_time: 900.0,
                        radius_hz: 430.0,
                        opacity: 0.63,
                        hardness,
                    },
                    channel: Some(1),
                    feather_time: 0.0,
                    feather_hz: 0.0,
                };
                for t in [0.0, 100.0, 512.0, 1000.0, 4096.0, 8800.0, 11000.0] {
                    let mut weights = vec![0.0; 1025];
                    mask.frame_weights(t, 48000.0 / 2048.0, &mut weights);
                    for (k, weight) in weights.iter().enumerate() {
                        assert!(
                            (weight - mask.weight(t, k as f64 * 48000.0 / 2048.0, 1)).abs() < 1e-11,
                            "t={t}, bin={k}, hardness={hardness:?}"
                        );
                    }
                }
            }
        }
    }
}
