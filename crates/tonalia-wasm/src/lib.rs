use sha_error::js_error;
use tonalia_core::{self as core, Layer, WavInfo};
use wasm_bindgen::prelude::*;
mod sha_error {
    pub fn js_error(e: impl ToString) -> wasm_bindgen::JsValue {
        wasm_bindgen::JsValue::from_str(&e.to_string())
    }
}
fn integer(n: f64) -> Result<u64, JsValue> {
    if !n.is_finite() || n < 0.0 || n.fract() != 0.0 || n > 9_007_199_254_740_991.0 {
        Err(js_error("Invalid sample/file coordinate"))
    } else {
        Ok(n as u64)
    }
}
#[wasm_bindgen]
pub fn inspect(bytes: &[u8], size: f64) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&core::inspect_wav(bytes, integer(size)?).map_err(js_error)?)
        .map_err(js_error)
}
#[wasm_bindgen]
pub fn decode(bytes: &[u8], info: JsValue) -> Result<Vec<f64>, JsValue> {
    let i: WavInfo = serde_wasm_bindgen::from_value(info).map_err(js_error)?;
    core::decode_frames(bytes, &i).map_err(js_error)
}
#[wasm_bindgen]
pub struct Spectrum {
    inner: core::Analyzer,
}
#[wasm_bindgen]
impl Spectrum {
    #[wasm_bindgen(constructor)]
    pub fn new(n: usize) -> Result<Spectrum, JsValue> {
        Ok(Self {
            inner: core::Analyzer::new(n).map_err(js_error)?,
        })
    }
    pub fn analyze(
        &mut self,
        samples: &[f64],
        channels: usize,
        channel: usize,
    ) -> Result<Vec<f32>, JsValue> {
        self.inner
            .spectrum(samples, channels, channel)
            .map_err(js_error)
    }
}
#[wasm_bindgen]
pub fn render(
    samples: &[f64],
    global_start: f64,
    info: JsValue,
    layers_json: &str,
) -> Result<Vec<f64>, JsValue> {
    let i: WavInfo = serde_wasm_bindgen::from_value(info).map_err(js_error)?;
    let layers: Vec<Layer> = serde_json::from_str(layers_json).map_err(js_error)?;
    core::validate_layers(&layers, i.frames, i.sample_rate, i.channels).map_err(js_error)?;
    core::render_layers(
        samples,
        integer(global_start)? as i64,
        i.sample_rate,
        i.channels as usize,
        &layers,
        2048,
    )
    .map_err(js_error)
}
#[wasm_bindgen]
pub fn resample(
    samples: &[f64],
    input_start: f64,
    source_position: f64,
    count: usize,
    source_rate: u32,
    device_rate: u32,
    channels: usize,
) -> Result<Vec<f32>, JsValue> {
    core::resample::monitor_resample(
        samples,
        integer(input_start)? as i64,
        source_position,
        count,
        source_rate,
        device_rate,
        channels,
    )
    .map_err(js_error)
}
#[wasm_bindgen]
pub struct Scan {
    inner: core::stats::StatisticsAccumulator,
    hash: sha2::Sha256,
}
#[wasm_bindgen]
impl Scan {
    #[wasm_bindgen(constructor)]
    pub fn new(channels: usize) -> Result<Scan, JsValue> {
        use sha2::Digest;
        Ok(Self {
            inner: core::stats::StatisticsAccumulator::new(channels).map_err(js_error)?,
            hash: sha2::Sha256::new(),
        })
    }
    pub fn push(&mut self, samples: &[f64]) -> Result<(), JsValue> {
        self.inner.push(samples).map_err(js_error)
    }
    pub fn hash_bytes(&mut self, bytes: &[u8]) {
        use sha2::Digest;
        self.hash.update(bytes);
    }
    pub fn statistics(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.result()).map_err(js_error)
    }
    pub fn fingerprint(&self) -> String {
        use sha2::Digest;
        format!("{:x}", self.hash.clone().finalize())
    }
}
#[wasm_bindgen]
pub fn wav_header(rate: u32, channels: u16, frames: f64, bits: u16) -> Result<Vec<u8>, JsValue> {
    core::float_wav_header(rate, channels, integer(frames)?, bits).map_err(js_error)
}
#[wasm_bindgen]
pub fn encode(samples: &[f64], bits: u16) -> Result<Vec<u8>, JsValue> {
    core::encode_float(samples, bits).map_err(js_error)
}
#[wasm_bindgen]
pub fn peak_bins(samples: &[f64], channels: usize, bin_frames: usize) -> Result<Vec<f32>, JsValue> {
    if channels == 0 || channels > 2 || bin_frames == 0 || !samples.len().is_multiple_of(channels) {
        return Err(js_error("Invalid waveform range"));
    }
    let mut out = Vec::new();
    for bin in samples.chunks(bin_frames * channels) {
        for c in 0..channels {
            let mut lo = 0f64;
            let mut hi = 0f64;
            for f in bin.chunks_exact(channels) {
                lo = lo.min(f[c]);
                hi = hi.max(f[c]);
            }
            out.push(lo as f32);
            out.push(hi as f32);
        }
    }
    Ok(out)
}

#[wasm_bindgen]
pub fn validate(info: JsValue, layers_json: &str) -> Result<(), JsValue> {
    let i: WavInfo = serde_wasm_bindgen::from_value(info).map_err(js_error)?;
    let layers: Vec<Layer> = serde_json::from_str(layers_json).map_err(js_error)?;
    core::validate_layers(&layers, i.frames, i.sample_rate, i.channels).map_err(js_error)
}
