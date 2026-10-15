use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::SystemTime,
};
use tonalia_core::{decode_frames, inspect_wav, render_layers, Layer, WavInfo};

#[derive(Default)]
struct RenderCache {
    graph: String,
    tiles: VecDeque<(u64, Arc<Vec<f64>>)>,
}
pub struct Source {
    pub path: PathBuf,
    pub file: Mutex<File>,
    pub info: WavInfo,
    pub size: u64,
    modified: Option<SystemTime>,
    cache: Mutex<RenderCache>,
}
impl Source {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let mut file = File::open(&path).map_err(|e| format!("Cannot open audio: {e}"))?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() {
            return Err("Choose an audio file.".into());
        }
        let mut prefix = vec![0; meta.len().min(4 * 1024 * 1024) as usize];
        file.read_exact(&mut prefix).map_err(|e| e.to_string())?;
        let info = inspect_wav(&prefix, meta.len())?;
        Ok(Self {
            path,
            file: Mutex::new(file),
            info,
            size: meta.len(),
            modified: meta.modified().ok(),
            cache: Mutex::new(RenderCache::default()),
        })
    }
    pub fn bytes(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
        if length > 8 * 1024 * 1024
            || offset
                .checked_add(length as u64)
                .is_none_or(|e| e > self.size)
        {
            return Err("Invalid or oversized source read.".into());
        }
        let mut file = self.file.lock().map_err(|_| "Source lock failed")?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if meta.len() != self.size || meta.modified().ok() != self.modified {
            return Err(
                "The source file changed outside Tonalia. Reopen it before continuing.".into(),
            );
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut b = vec![0; length];
        file.read_exact(&mut b)
            .map_err(|e| format!("Source read failed: {e}"))?;
        Ok(b)
    }
    pub fn samples(&self, start: u64, end: u64) -> Result<Vec<f64>, String> {
        let start = start.min(self.info.frames);
        let end = end.min(self.info.frames).max(start);
        let ch = self.info.channels as usize;
        if (end - start).saturating_mul(ch as u64) > 16_000_000 {
            return Err("Render input exceeds the working-memory budget.".into());
        }
        let mut pcm = Vec::with_capacity((end - start) as usize * ch);
        let chunk = 8 * 1024 * 1024 / self.info.block_align as u64;
        let mut at = start;
        while at < end {
            let next = (at + chunk).min(end);
            pcm.extend(decode_frames(
                &self.bytes(
                    self.info.data_offset + at * self.info.block_align as u64,
                    ((next - at) * self.info.block_align as u64) as usize,
                )?,
                &self.info,
            )?);
            at = next;
        }
        Ok(pcm)
    }
    pub fn render(&self, start: u64, end: u64, layers: &[Layer]) -> Result<Vec<f64>, String> {
        if start > end || end > self.info.frames {
            return Err("Invalid source render range.".into());
        }
        // Check the underlying source even on cache hits; no stale audio after external edits.
        self.bytes(self.info.data_offset, 0)?;
        if layers.iter().all(|l| !l.active()) {
            return self.samples(start, end);
        }
        let graph = serde_json::to_string(layers).map_err(|e| e.to_string())?;
        let ch = self.info.channels as usize;
        let mut out = Vec::with_capacity((end - start) as usize * ch);
        let mut t = start / 32768 * 32768;
        while t < end {
            let cached = {
                let mut cache = self.cache.lock().map_err(|_| "Render cache unavailable")?;
                if cache.graph != graph {
                    cache.graph = graph.clone();
                    cache.tiles.clear();
                }
                cache
                    .tiles
                    .iter()
                    .find(|(at, _)| *at == t)
                    .map(|(_, pcm)| pcm.clone())
            };
            let tile = if let Some(tile) = cached {
                tile
            } else {
                let tile_end = (t + 32768).min(self.info.frames);
                let halo = tonalia_core::render_halo(layers);
                let a = t.saturating_sub(halo);
                let b = (tile_end + halo).min(self.info.frames);
                let pcm = self.samples(a, b)?;
                let y = render_layers(&pcm, a as i64, self.info.sample_rate, ch, layers, 2048)?;
                let tile =
                    Arc::new(y[(t - a) as usize * ch..(tile_end - a) as usize * ch].to_vec());
                let mut cache = self.cache.lock().map_err(|_| "Render cache unavailable")?;
                if cache.graph == graph {
                    cache.tiles.push_back((t, tile.clone()));
                    while cache.tiles.len() > 16 {
                        cache.tiles.pop_front();
                    }
                }
                tile
            };
            let a = start.max(t);
            let b = end.min(t + 32768);
            out.extend_from_slice(&tile[(a - t) as usize * ch..(b - t) as usize * ch]);
            t += 32768;
        }
        Ok(out)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn cached_render_is_chunk_invariant_and_still_detects_source_changes() {
        let path =
            std::env::temp_dir().join(format!("tonalia-cache-test-{}.wav", std::process::id()));
        let frames = 100000;
        let x: Vec<_> = (0..frames).map(|i| 0.2 * (i as f64 * 0.1).sin()).collect();
        let mut bytes = tonalia_core::float_wav_header(48000, 1, frames, 64).unwrap();
        bytes.extend(tonalia_core::encode_float(&x, 64).unwrap());
        std::fs::write(&path, &bytes).unwrap();
        let source = Source::open(path.clone()).unwrap();
        let layers:Vec<Layer>=serde_json::from_value(serde_json::json!([{"id":"test","name":"Gate","enabled":true,"gainDb":0,"processor":{"kind":"spectralGate","thresholdDb":0,"reductionDb":24},"mask":{"shape":{"kind":"rectangle","start":0,"end":frames,"low":0,"high":24000},"channel":null,"featherTime":0,"featherHz":0}}])).unwrap();
        let all = source.render(0, frames, &layers).unwrap();
        for (a, b) in [(30000, 34000), (65500, 66000), (4096, 8192)] {
            assert_eq!(
                &all[a as usize..b as usize],
                source.render(a, b, &layers).unwrap()
            );
        }
        assert_eq!(source.render(0, frames, &[]).unwrap(), x);
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(&[0])
            .unwrap();
        assert!(source.render(30000, 34000, &layers).is_err());
        drop(source);
        std::fs::remove_file(path).unwrap();
    }
    use std::fs::OpenOptions;
}
