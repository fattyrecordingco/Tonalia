use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub float: bool,
    pub frames: u64,
    pub data_offset: u64,
    pub data_bytes: u64,
    pub block_align: u16,
    pub rf64: bool,
}
fn u16_at(b: &[u8], p: usize) -> Result<u16, String> {
    b.get(p..p + 2)
        .map(|x| u16::from_le_bytes([x[0], x[1]]))
        .ok_or("Truncated WAV header".into())
}
fn u32_at(b: &[u8], p: usize) -> Result<u32, String> {
    b.get(p..p + 4)
        .map(|x| u32::from_le_bytes(x.try_into().unwrap()))
        .ok_or("Truncated WAV header".into())
}
fn u64_at(b: &[u8], p: usize) -> Result<u64, String> {
    b.get(p..p + 8)
        .map(|x| u64::from_le_bytes(x.try_into().unwrap()))
        .ok_or("Truncated RF64 header".into())
}
/// Inspect a bounded header prefix. Audio is decoded in separate, aligned ranges.
pub fn inspect_wav(prefix: &[u8], file_size: u64) -> Result<WavInfo, String> {
    if prefix.len() < 12 || &prefix[8..12] != b"WAVE" {
        return Err("Open a PCM or IEEE-float WAV file.".into());
    }
    let rf64 = &prefix[..4] == b"RF64";
    if !rf64 && &prefix[..4] != b"RIFF" {
        return Err("Only little-endian RIFF WAV and RF64 are supported.".into());
    }
    let mut p = 12usize;
    let mut format = None;
    let mut rf_data = None;
    while p.checked_add(8).is_some_and(|e| e <= prefix.len()) {
        let tag = &prefix[p..p + 4];
        let size = u32_at(prefix, p + 4)? as u64;
        let body = p + 8;
        if tag == b"ds64" && rf64 {
            if size < 28 {
                return Err("Invalid RF64 ds64 chunk".into());
            }
            rf_data = Some(u64_at(prefix, body + 8)?);
        }
        if tag == b"fmt " {
            if size < 16
                || (body as u64)
                    .checked_add(size)
                    .is_none_or(|e| e > prefix.len() as u64)
            {
                return Err("Incomplete WAV format chunk".into());
            }
            let mut code = u16_at(prefix, body)?;
            let channels = u16_at(prefix, body + 2)?;
            let rate = u32_at(prefix, body + 4)?;
            let align = u16_at(prefix, body + 12)?;
            let bits = u16_at(prefix, body + 14)?;
            if code == 0xfffe {
                if size < 40 || u16_at(prefix, body + 16)? < 22 {
                    return Err("Invalid extensible WAV format".into());
                }
                let valid = u16_at(prefix, body + 18)?;
                if valid != bits && valid != 0 {
                    return Err("Packed WAV valid-bit depths are not supported yet.".into());
                }
                code = u16_at(prefix, body + 24)?;
                if prefix.get(body + 26..body + 40)
                    != Some(&[0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71][..])
                {
                    return Err("Unsupported WAV subformat GUID".into());
                }
            }
            if !(1..=2).contains(&channels) {
                return Err("This release supports mono and stereo WAV files. Multichannel editing is not yet qualified.".into());
            }
            if !(8000..=192000).contains(&rate) {
                return Err("Supported source sample rates are 8–192 kHz.".into());
            }
            if !(code == 1 && [8, 16, 24, 32].contains(&bits)
                || code == 3 && [32, 64].contains(&bits))
            {
                return Err(
                    "Unsupported WAV encoding. Use integer PCM or 32/64-bit IEEE float.".into(),
                );
            }
            if align != channels * (bits / 8)
                || u32_at(prefix, body + 8)? as u64 != rate as u64 * align as u64
            {
                return Err("Inconsistent WAV block alignment or byte rate".into());
            }
            format = Some((rate, channels, bits, code == 3, align));
        }
        if tag == b"data" {
            let (sample_rate, channels, bits_per_sample, float, block_align) =
                format.ok_or("The WAV format chunk must precede audio data.")?;
            let data_bytes = if rf64 && size == u32::MAX as u64 {
                rf_data.ok_or("RF64 is missing its data size")?
            } else {
                size
            };
            let data_offset = body as u64;
            if data_bytes == 0 || data_bytes % block_align as u64 != 0 {
                return Err("WAV audio is empty or ends in a partial sample frame.".into());
            }
            if data_offset
                .checked_add(data_bytes)
                .is_none_or(|end| end > file_size)
            {
                return Err("WAV audio data is truncated.".into());
            }
            if data_bytes / block_align as u64 > (1u64 << 48) {
                return Err("Source duration exceeds the supported sample-address range.".into());
            }
            return Ok(WavInfo {
                sample_rate,
                channels,
                bits_per_sample,
                float,
                frames: data_bytes / block_align as u64,
                data_offset,
                data_bytes,
                block_align,
                rf64,
            });
        }
        let next = (body as u64)
            .checked_add(size)
            .and_then(|v| v.checked_add(size & 1))
            .ok_or("WAV chunk length overflow")?;
        if next > file_size {
            return Err("WAV chunk exceeds file size".into());
        }
        p = usize::try_from(next).map_err(|_| "WAV header offset overflow")?;
    }
    Err("No audio data found in the first 4 MiB of the WAV header. Re-save the file with a standard WAV layout.".into())
}
/// Decode an aligned interleaved block to f64 without downmixing or resampling.
pub fn decode_frames(bytes: &[u8], info: &WavInfo) -> Result<Vec<f64>, String> {
    if info.block_align == 0
        || ![8, 16, 24, 32, 64].contains(&info.bits_per_sample)
        || !(1..=2).contains(&info.channels)
        || info.block_align != info.channels * (info.bits_per_sample / 8)
        || !bytes.len().is_multiple_of(info.block_align as usize)
    {
        return Err("Decode range is not frame aligned".into());
    }
    let width = (info.bits_per_sample / 8) as usize;
    let mut out = Vec::with_capacity(bytes.len() / width);
    for b in bytes.chunks_exact(width) {
        let v = match (info.float, info.bits_per_sample) {
            (false, 8) => (b[0] as f64 - 128.0) / 128.0,
            (false, 16) => i16::from_le_bytes(b.try_into().unwrap()) as f64 / 32768.0,
            (false, 24) => {
                let v = ((b[2] as i32) << 24) | ((b[1] as i32) << 16) | ((b[0] as i32) << 8);
                (v >> 8) as f64 / 8388608.0
            }
            (false, 32) => i32::from_le_bytes(b.try_into().unwrap()) as f64 / 2147483648.0,
            (true, 32) => f32::from_le_bytes(b.try_into().unwrap()) as f64,
            (true, 64) => f64::from_le_bytes(b.try_into().unwrap()),
            _ => return Err("Unsupported sample encoding".into()),
        };
        if !v.is_finite() {
            return Err(
                "Audio contains NaN or infinity. Nonfinite samples cannot be processed safely."
                    .into(),
            );
        }
        if v.abs() > 1_000_000.0 {
            return Err("Source audio exceeds the supported +120 dBFS float headroom.".into());
        }
        out.push(v);
    }
    Ok(out)
}
/// Float WAV/RF64 header. Audio frame count and sample rate are never inferred from a device.
pub fn float_wav_header(
    rate: u32,
    channels: u16,
    frames: u64,
    bits: u16,
) -> Result<Vec<u8>, String> {
    if !(1..=2).contains(&channels) || ![32, 64].contains(&bits) || !(8000..=192000).contains(&rate)
    {
        return Err("Invalid WAV export format".into());
    }
    let align = channels * (bits / 8);
    let bytes = frames
        .checked_mul(align as u64)
        .ok_or("WAV export size overflow")?;
    let rf = bytes > u32::MAX as u64 - 36;
    let mut b = Vec::new();
    b.extend_from_slice(if rf { b"RF64" } else { b"RIFF" });
    b.extend_from_slice(&(if rf { u32::MAX } else { (bytes + 36) as u32 }).to_le_bytes());
    b.extend_from_slice(b"WAVE");
    if rf {
        b.extend_from_slice(b"ds64");
        b.extend_from_slice(&28u32.to_le_bytes());
        b.extend_from_slice(&(bytes + 72).to_le_bytes());
        b.extend_from_slice(&bytes.to_le_bytes());
        b.extend_from_slice(&frames.to_le_bytes());
        b.extend_from_slice(&0u32.to_le_bytes());
    }
    b.extend_from_slice(b"fmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&3u16.to_le_bytes());
    b.extend_from_slice(&channels.to_le_bytes());
    b.extend_from_slice(&rate.to_le_bytes());
    b.extend_from_slice(&(rate * align as u32).to_le_bytes());
    b.extend_from_slice(&align.to_le_bytes());
    b.extend_from_slice(&bits.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(if rf { u32::MAX } else { bytes as u32 }).to_le_bytes());
    Ok(b)
}
pub fn encode_float(samples: &[f64], bits: u16) -> Result<Vec<u8>, String> {
    if ![32, 64].contains(&bits) {
        return Err("Choose 32-bit or 64-bit float WAV".into());
    }
    let mut b = Vec::with_capacity(samples.len() * bits as usize / 8);
    for &v in samples {
        if !v.is_finite() || bits == 32 && !(v as f32).is_finite() {
            return Err("Output contains a nonfinite or unrepresentable sample".into());
        }
        if bits == 32 {
            b.extend_from_slice(&(v as f32).to_le_bytes());
        } else {
            b.extend_from_slice(&v.to_le_bytes());
        }
    }
    Ok(b)
}
