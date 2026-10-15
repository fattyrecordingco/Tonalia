use crate::media::Source;
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, SizedSample,
};
use rtrb::{Consumer, RingBuffer};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
    mpsc, Arc,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tonalia_core::{resample::monitor_resample, Layer};

pub struct Playback {
    pub stop: AtomicBool,
    pub volume: AtomicU32,
    consumed: AtomicU64,
    underruns: AtomicU64,
    finished: AtomicBool,
    failed: AtomicBool,
}
impl Playback {
    pub fn new(volume: f32) -> Self {
        Self {
            stop: AtomicBool::new(false),
            volume: AtomicU32::new(volume.to_bits()),
            consumed: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            finished: AtomicBool::new(false),
            failed: AtomicBool::new(false),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub backend: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub session: String,
    pub position: f64,
    pub playing: bool,
    pub underruns: u64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    pub session: String,
    pub position: u64,
    pub end: u64,
    pub layers: Vec<Layer>,
    pub mode: String,
    pub volume: f32,
    pub looping: bool,
}
fn stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    mut consumer: Consumer<[f32; 2]>,
    ctrl: Arc<Playback>,
    source_channels: usize,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let out_channels = config.channels as usize;
    let failure = ctrl.clone();
    device
        .build_output_stream(
            config.clone(),
            move |data: &mut [T], _: &cpal::OutputCallbackInfo| {
                let volume = f32::from_bits(ctrl.volume.load(Ordering::Relaxed));
                let mut consumed = 0;
                let mut missed = false;
                for frame in data.chunks_mut(out_channels) {
                    let pair = if ctrl.stop.load(Ordering::Relaxed) {
                        [0.0, 0.0]
                    } else {
                        match consumer.pop() {
                            Ok(f) => {
                                consumed += 1;
                                f
                            }
                            Err(_) => {
                                if !ctrl.finished.load(Ordering::Acquire) {
                                    missed = true;
                                }
                                [0.0, 0.0]
                            }
                        }
                    };
                    for (c, out) in frame.iter_mut().enumerate() {
                        let sample = if out_channels == 1 {
                            if source_channels == 1 {
                                pair[0]
                            } else {
                                (pair[0] + pair[1]) * 0.5
                            }
                        } else if c < 2 {
                            pair[c]
                        } else {
                            0.0
                        };
                        *out = T::from_sample(sample * volume);
                    }
                }
                ctrl.consumed.fetch_add(consumed, Ordering::Relaxed);
                if missed {
                    ctrl.underruns.fetch_add(1, Ordering::Relaxed);
                    ctrl.failed.store(true, Ordering::Release);
                }
            },
            move |_| {
                failure.failed.store(true, Ordering::Release);
            },
            Some(Duration::from_secs(3)),
        )
        .map_err(|e| format!("Cannot open the output device: {e}"))
}
pub fn start(
    app: AppHandle,
    source: Arc<Source>,
    request: PlayRequest,
    ctrl: Arc<Playback>,
) -> Result<DeviceInfo, String> {
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let host = cpal::default_host();
            let device = host
                .default_output_device()
                .ok_or("No audio output device is available.")?;
            let supported = device.default_output_config().map_err(|e| e.to_string())?;
            let rate = supported.sample_rate();
            let format = supported.sample_format();
            let config: cpal::StreamConfig = supported.into();
            let name = device
                .description()
                .map(|d| d.name().to_string())
                .unwrap_or_else(|_| "Default output".into());
            let details = DeviceInfo {
                name,
                sample_rate: rate,
                channels: config.channels,
                backend: format!("{}", host.id().name()),
            };
            let (mut producer, consumer) = RingBuffer::<[f32; 2]>::new(32768);
            let producer_ctrl = ctrl.clone();
            let input = source.clone();
            let req = request.clone();
            std::thread::spawn(move || {
                let produced = (|| -> Result<(), String> {
                    let mut position = req.position as f64;
                    let channels = input.info.channels as usize;
                    while !producer_ctrl.stop.load(Ordering::Acquire) {
                        let count = 4096usize.min(
                            ((req.end as f64 - position) * rate as f64
                                / input.info.sample_rate as f64)
                                .ceil()
                                .max(0.0) as usize,
                        );
                        if count == 0 {
                            if req.looping {
                                position = req.position as f64;
                                continue;
                            }
                            break;
                        }
                        let start = (position.floor() as u64).saturating_sub(64);
                        let end = ((position
                            + count as f64 * input.info.sample_rate as f64 / rate as f64)
                            .ceil() as u64
                            + 64)
                            .min(input.info.frames);
                        let mut pcm = if req.mode == "original" {
                            input.samples(start, end)?
                        } else {
                            input.render(start, end, &req.layers)?
                        };
                        if req.mode == "removed" {
                            let original = input.samples(start, end)?;
                            for (a, b) in pcm.iter_mut().zip(original) {
                                *a = b - *a;
                            }
                        }
                        let audio = monitor_resample(
                            &pcm,
                            start as i64,
                            position,
                            count,
                            input.info.sample_rate,
                            rate,
                            channels,
                        )?;
                        for f in audio.chunks_exact(channels) {
                            while producer.is_full() {
                                if producer_ctrl.stop.load(Ordering::Acquire) {
                                    return Ok(());
                                }
                                std::thread::sleep(Duration::from_millis(2));
                            }
                            if producer_ctrl.stop.load(Ordering::Acquire) {
                                return Ok(());
                            }
                            producer
                                .push([f[0], if channels == 2 { f[1] } else { f[0] }])
                                .map_err(|_| "Audio queue rejected a frame")?;
                        }
                        position += count as f64 * input.info.sample_rate as f64 / rate as f64;
                    }
                    Ok(())
                })();
                if produced.is_err() {
                    producer_ctrl.failed.store(true, Ordering::Release);
                }
                producer_ctrl.finished.store(true, Ordering::Release);
            });
            // Prefill outside the device callback. The UI receives a real error if rendering cannot keep up.
            let deadline = Instant::now() + Duration::from_secs(10);
            while consumer.slots() < 8192
                && !ctrl.finished.load(Ordering::Acquire)
                && !ctrl.failed.load(Ordering::Acquire)
            {
                if Instant::now() > deadline {
                    return Err("Audio preparation timed out. Reduce the layer count or preview a shorter range.".into());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            let audio = match format {
                cpal::SampleFormat::F32 => stream::<f32>(
                    &device,
                    &config,
                    consumer,
                    ctrl.clone(),
                    source.info.channels as usize,
                )?,
                cpal::SampleFormat::I16 => stream::<i16>(
                    &device,
                    &config,
                    consumer,
                    ctrl.clone(),
                    source.info.channels as usize,
                )?,
                cpal::SampleFormat::I32 => stream::<i32>(
                    &device,
                    &config,
                    consumer,
                    ctrl.clone(),
                    source.info.channels as usize,
                )?,
                cpal::SampleFormat::F64 => stream::<f64>(
                    &device,
                    &config,
                    consumer,
                    ctrl.clone(),
                    source.info.channels as usize,
                )?,
                _ => {
                    return Err(
                        "The output device sample format is not supported in this release.".into(),
                    )
                }
            };
            audio.play().map_err(|e| e.to_string())?;
            let _ = send.send(Ok(details));
            loop {
                let consumed = ctrl.consumed.load(Ordering::Relaxed);
                let elapsed = consumed as f64 * source.info.sample_rate as f64 / rate as f64;
                let span = (request.end - request.position) as f64;
                let position = request.position as f64
                    + if request.looping {
                        elapsed % span
                    } else {
                        elapsed.min(span)
                    };
                let ended = ctrl.stop.load(Ordering::Acquire)
                    || ctrl.failed.load(Ordering::Acquire)
                    || (!request.looping && position >= request.end as f64 - 1.0);
                let _ = app.emit(
                    "audio-position",
                    Position {
                        session: request.session.clone(),
                        position,
                        playing: !ended,
                        underruns: ctrl.underruns.load(Ordering::Relaxed),
                    },
                );
                if ended {
                    break;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            ctrl.stop.store(true, Ordering::Release);
            drop(audio);
            if ctrl.failed.load(Ordering::Acquire) {
                return Err("Playback stopped because the audio device or render queue missed a deadline. The source is unchanged.".into());
            }
            Ok(())
        })();
        if let Err(error) = result {
            ctrl.stop.store(true, Ordering::Release);
            let _ = send.send(Err(error.clone()));
            let _ = app.emit(
                "audio-error",
                serde_json::json!({"session":request.session,"error":error}),
            );
        }
    });
    receive
        .recv_timeout(Duration::from_secs(14))
        .map_err(|_| "Audio output did not initialize in time".to_string())?
}
