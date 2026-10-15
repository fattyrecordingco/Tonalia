use serde::Serialize;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStats {
    pub peak: f64,
    pub peak_frame: u64,
    pub rms: f64,
    pub dc: f64,
    pub min: f64,
    pub max: f64,
    pub full_scale_samples: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub frames: u64,
    pub channels: Vec<ChannelStats>,
    pub correlation: Option<f64>,
}
pub struct StatisticsAccumulator {
    channels: usize,
    frames: u64,
    peak: Vec<f64>,
    peak_frame: Vec<u64>,
    sum: Vec<f64>,
    energy: Vec<f64>,
    min: Vec<f64>,
    max: Vec<f64>,
    full: Vec<u64>,
    cross: f64,
}
impl StatisticsAccumulator {
    pub fn new(channels: usize) -> Result<Self, String> {
        if !(1..=2).contains(&channels) {
            return Err("Statistics require mono or stereo.".into());
        }
        Ok(Self {
            channels,
            frames: 0,
            peak: vec![0.0; channels],
            peak_frame: vec![0; channels],
            sum: vec![0.0; channels],
            energy: vec![0.0; channels],
            min: vec![f64::INFINITY; channels],
            max: vec![f64::NEG_INFINITY; channels],
            full: vec![0; channels],
            cross: 0.0,
        })
    }
    pub fn push(&mut self, samples: &[f64]) -> Result<(), String> {
        if !samples.len().is_multiple_of(self.channels) || samples.iter().any(|x| !x.is_finite()) {
            return Err("Statistics input is invalid.".into());
        }
        for f in samples.chunks_exact(self.channels) {
            for (c, &x) in f.iter().enumerate() {
                if x.abs() > self.peak[c] {
                    self.peak[c] = x.abs();
                    self.peak_frame[c] = self.frames;
                }
                self.sum[c] += x;
                self.energy[c] += x * x;
                self.min[c] = self.min[c].min(x);
                self.max[c] = self.max[c].max(x);
                if x.abs() >= 1.0 {
                    self.full[c] += 1;
                }
            }
            if self.channels == 2 {
                self.cross += f[0] * f[1];
            }
            self.frames += 1;
        }
        Ok(())
    }
    pub fn result(&self) -> Statistics {
        let n = self.frames.max(1) as f64;
        let channels = (0..self.channels)
            .map(|c| ChannelStats {
                peak: self.peak[c],
                peak_frame: self.peak_frame[c],
                rms: (self.energy[c] / n).sqrt(),
                dc: self.sum[c] / n,
                min: if self.frames == 0 { 0.0 } else { self.min[c] },
                max: if self.frames == 0 { 0.0 } else { self.max[c] },
                full_scale_samples: self.full[c],
            })
            .collect();
        let correlation = if self.channels == 2 && self.energy[0] > 1e-20 && self.energy[1] > 1e-20
        {
            Some((self.cross / self.energy[0].sqrt() / self.energy[1].sqrt()).clamp(-1.0, 1.0))
        } else {
            None
        };
        Statistics {
            frames: self.frames,
            channels,
            correlation,
        }
    }
}
