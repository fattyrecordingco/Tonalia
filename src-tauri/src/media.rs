use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::Mutex,
    time::SystemTime,
};
use tonalia_core::{decode_frames, inspect_wav, render_layers, Layer, WavInfo};

pub struct Source {
    pub path: PathBuf,
    pub file: Mutex<File>,
    pub info: WavInfo,
    pub size: u64,
    modified: Option<SystemTime>,
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
        decode_frames(
            &self.bytes(
                self.info.data_offset + start * self.info.block_align as u64,
                ((end - start) * self.info.block_align as u64) as usize,
            )?,
            &self.info,
        )
    }
    pub fn render(&self, start: u64, end: u64, layers: &[Layer]) -> Result<Vec<f64>, String> {
        if start > end || end > self.info.frames {
            return Err("Invalid source render range.".into());
        }
        let active = layers
            .iter()
            .filter(|l| l.enabled && l.gain_db != 0.0)
            .count();
        if active == 0 {
            return self.samples(start, end);
        }
        let halo = (2048 * (active + 1)) as u64;
        let a = start.saturating_sub(halo);
        let b = (end + halo).min(self.info.frames);
        let pcm = self.samples(a, b)?;
        let y = render_layers(
            &pcm,
            a as i64,
            self.info.sample_rate,
            self.info.channels as usize,
            layers,
            2048,
        )?;
        let ch = self.info.channels as usize;
        Ok(y[((start - a) as usize * ch)..((end - a) as usize * ch)].to_vec())
    }
}
