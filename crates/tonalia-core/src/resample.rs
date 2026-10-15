use std::f64::consts::PI;
/// Bounded windowed-sinc monitor conversion. Export remains at source rate.
/// This is not yet qualified as a final-delivery sample-rate converter.
pub fn monitor_resample(
    input: &[f64],
    input_start: i64,
    source_position: f64,
    count: usize,
    source_rate: u32,
    device_rate: u32,
    channels: usize,
) -> Result<Vec<f32>, String> {
    if source_rate == 0
        || device_rate == 0
        || channels == 0
        || channels > 2
        || !source_position.is_finite()
        || !input.len().is_multiple_of(channels)
        || input
            .iter()
            .any(|v| !v.is_finite() || v.abs() > f32::MAX as f64)
    {
        return Err("Invalid monitor conversion parameters".into());
    }
    let ratio = source_rate as f64 / device_rate as f64;
    let frames = input.len() / channels;
    let mut out = vec![0f32; count * channels];
    let at = |p: i64, c: usize| {
        if p >= input_start && p < input_start + frames as i64 {
            input[(p - input_start) as usize * channels + c]
        } else {
            0.0
        }
    };
    for i in 0..count {
        let pos = source_position + i as f64 * ratio;
        if source_rate == device_rate && pos.fract().abs() < 1e-9 {
            for c in 0..channels {
                out[i * channels + c] = at(pos as i64, c) as f32;
            }
            continue;
        }
        let base = pos.floor() as i64;
        let cutoff = 0.94 * (device_rate as f64 / source_rate as f64).min(1.0);
        let mut weights = [0.0; 64];
        let mut norm = 0.0;
        for (j, w) in weights.iter_mut().enumerate() {
            let delta = (base + j as i64 - 31) as f64 - pos;
            let v = PI * delta * cutoff;
            let sinc = if v.abs() < 1e-12 { 1.0 } else { v.sin() / v };
            *w = cutoff * sinc * 0.5 * (1.0 + (PI * delta / 32.0).cos());
            norm += *w;
        }
        for c in 0..channels {
            out[i * channels + c] = (weights
                .iter()
                .enumerate()
                .map(|(j, w)| at(base + j as i64 - 31, c) * w)
                .sum::<f64>()
                / norm) as f32;
        }
    }
    Ok(out)
}
