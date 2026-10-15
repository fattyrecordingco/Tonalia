use std::f64::consts::PI;
use tonalia_core::{
    resample::monitor_resample,
    spectral::{Mask, Point, Shape},
    stats::StatisticsAccumulator,
    *,
};
fn tone(frames: usize, rate: f64, f: f64) -> Vec<f64> {
    (0..frames)
        .map(|i| 0.5 * (2.0 * PI * f * i as f64 / rate).sin())
        .collect()
}
fn layer(ch: Option<u16>) -> Layer {
    Layer {
        id: "test".into(),
        name: "Test gain".into(),
        enabled: true,
        gain_db: -18.0,
        mask: Mask {
            shape: Shape::Rectangle {
                start: 4000.0,
                end: 14000.0,
                low: 750.0,
                high: 1200.0,
            },
            channel: ch,
            feather_time: 240.0,
            feather_hz: 46.875,
        },
    }
}
fn info(bits: u16, float: bool, channels: u16, frames: u64) -> WavInfo {
    WavInfo {
        sample_rate: 48000,
        channels,
        bits_per_sample: bits,
        float,
        frames,
        data_offset: 44,
        data_bytes: frames * channels as u64 * (bits / 8) as u64,
        block_align: channels * (bits / 8),
        rf64: false,
    }
}
#[test]
fn calibrated_peak_and_dc() {
    for n in [256, 512, 2048, 8192] {
        let mut a = Analyzer::new(n).unwrap();
        let f = 48000.0 * 7.0 / n as f64;
        let x: Vec<_> = tone(n, 48000.0, f).into_iter().map(|v| v * 2.0).collect();
        let s = a.spectrum(&x, 1, 0).unwrap();
        assert!(s[7].abs() < 1e-5, "N={n} peak={}", s[7]);
        let dc = a.spectrum(&vec![0.5; n], 1, 0).unwrap();
        assert!((dc[0] as f64 + 6.020599913).abs() < 1e-5);
    }
}
#[test]
fn silence_is_finite_and_floor_only() {
    let mut a = Analyzer::new(2048).unwrap();
    let s = a.spectrum(&vec![0.0; 2048], 1, 0).unwrap();
    assert!(s.iter().all(|&x| x == -240.0));
}
#[test]
fn integer_extremes_and_f64_precision() {
    let v = decode_frames(&[0, 0, 0x80, 0xff, 0xff, 0x7f], &info(24, false, 1, 2)).unwrap();
    assert_eq!(v, vec![-1.0, 8388607.0 / 8388608.0]);
    let raw = [i32::MIN, i32::MAX, 1, -1]
        .iter()
        .flat_map(|x| x.to_le_bytes())
        .collect::<Vec<_>>();
    let x = decode_frames(&raw, &info(32, false, 1, 4)).unwrap();
    assert_eq!(x[2], 1.0 / 2147483648.0);
    assert_eq!(x[1], 2147483647.0 / 2147483648.0);
}
#[test]
fn no_downmix_and_float_headroom() {
    let samples = [1.5, -0.5, 0.1234567890123, -0.8];
    let b = encode_float(&samples, 64).unwrap();
    assert_eq!(decode_frames(&b, &info(64, true, 2, 2)).unwrap(), samples);
}
#[test]
fn reject_nonfinite_and_partial_frames() {
    assert!(decode_frames(&f32::NAN.to_le_bytes(), &info(32, true, 1, 1)).is_err());
    assert!(decode_frames(&[0, 1, 2], &info(16, false, 2, 1)).is_err());
    assert!(encode_float(&[f64::MAX], 32).is_err());
}
#[test]
fn wav_header_and_rf64_roundtrip() {
    for bits in [32, 64] {
        for frames in [1, 1000, 600_000_000] {
            let b = float_wav_header(96000, 2, frames, bits).unwrap();
            let parsed = inspect_wav(&b, b.len() as u64 + frames * 2 * (bits / 8) as u64).unwrap();
            assert_eq!(parsed.frames, frames);
            assert_eq!(parsed.sample_rate, 96000);
            assert_eq!(parsed.data_offset, b.len() as u64);
            assert_eq!(
                parsed.rf64,
                frames * 2 * (bits / 8) as u64 > u32::MAX as u64 - 36
            );
        }
    }
}
#[test]
fn reject_truncated_or_wrong_format() {
    let b = float_wav_header(48000, 2, 100, 32).unwrap();
    assert!(inspect_wav(&b, 50).is_err());
    let mut corrupt = b.clone();
    corrupt[32] = 1;
    assert!(inspect_wav(&corrupt, 844).is_err());
    assert!(inspect_wav(b"not a WAV", 9).is_err());
}
#[test]
fn mask_blend_and_channel_scope() {
    let mut l = layer(Some(0));
    l.mask.feather_time = 0.0;
    l.mask.feather_hz = 0.0;
    assert_eq!(l.mask.weight(8000.0, 1000.0, 0), 1.0);
    assert_eq!(l.mask.weight(8000.0, 1000.0, 1), 0.0);
    assert_eq!(l.mask.weight(3000.0, 1000.0, 0), 0.0);
    l.mask.feather_hz = 100.0;
    assert!((l.mask.weight(8000.0, 700.0, 0) - 0.5).abs() < 1e-12);
}
#[test]
fn brush_accumulation() {
    let m = Mask {
        shape: Shape::Brush {
            points: vec![
                Point {
                    sample: 1000.0,
                    hz: 1000.0
                };
                2
            ],
            radius_time: 100.0,
            radius_hz: 100.0,
            opacity: 0.5,
        },
        channel: None,
        feather_time: 0.0,
        feather_hz: 0.0,
    };
    assert!((m.weight(1000.0, 1000.0, 0) - 0.75).abs() < 1e-12);
}
#[test]
fn lasso_and_validation() {
    let mut l = layer(None);
    l.mask.shape = Shape::Polygon {
        points: vec![
            Point {
                sample: 1000.0,
                hz: 500.0,
            },
            Point {
                sample: 3000.0,
                hz: 500.0,
            },
            Point {
                sample: 2000.0,
                hz: 1500.0,
            },
        ],
    };
    assert!(l.mask.weight(2000.0, 800.0, 0) > 0.99);
    assert_eq!(l.mask.weight(6000.0, 800.0, 0), 0.0);
    assert!(validate_layers(&[l.clone()], 20000, 48000, 2).is_ok());
    l.gain_db = f64::NAN;
    assert!(validate_layers(&[l], 20000, 48000, 2).is_err());
}
#[test]
fn no_op_is_exact() {
    let x = tone(10007, 48000.0, 937.5);
    let mut l = layer(None);
    l.gain_db = 0.0;
    assert_eq!(render_layers(&x, 0, 48000, 1, &[l], 2048).unwrap(), x);
}
#[test]
fn spectral_gain_preserves_other_channel_and_locality() {
    let x = tone(20000, 48000.0, 937.5);
    let stereo = x.iter().flat_map(|&v| [v, v]).collect::<Vec<_>>();
    let y = render_layers(&stereo, 0, 48000, 2, &[layer(Some(0))], 2048).unwrap();
    let gain = 10f64.powf(-18.0 / 20.0);
    let err = (6000..12000)
        .map(|i| (y[i * 2] - x[i] * gain).abs())
        .fold(0.0, f64::max);
    assert!(err < 1e-12, "gain error {err}");
    assert!((0..x.len()).all(|i| y[2 * i + 1] == x[i]));
    assert!((0..2000).all(|i| y[2 * i] == x[i]));
    assert!((17000..20000).all(|i| y[2 * i] == x[i]));
}
#[test]
fn weighted_blend_matches_linear_contract() {
    let x = tone(20000, 48000.0, 937.5);
    let mut l = layer(None);
    l.mask.shape = Shape::Rectangle {
        start: 4000.0,
        end: 14000.0,
        low: 0.0,
        high: 24000.0,
    };
    l.mask.feather_hz = 0.0;
    l.gain_db = -6.0;
    let y = render_layers(&x, 0, 48000, 1, &[l], 2048).unwrap();
    let g = 10f64.powf(-6.0 / 20.0);
    let e = (6500..11000)
        .map(|i| (y[i] - g * x[i]).abs())
        .fold(0.0, f64::max);
    assert!(e < 1e-12);
}
#[test]
fn chunked_serial_layers_equal_whole_render() {
    let x: Vec<_> = (0..25007)
        .map(|i| 0.3 * (i as f64 * 0.123).sin() + 0.15 * (i as f64 * 0.41).cos())
        .collect();
    let mut b = layer(None);
    b.id = "second".into();
    b.gain_db = 4.0;
    b.mask.shape = Shape::Rectangle {
        start: 8000.0,
        end: 19000.0,
        low: 1000.0,
        high: 5000.0,
    };
    let layers = [layer(None), b];
    let whole = render_layers(&x, 0, 48000, 1, &layers, 2048).unwrap();
    for chunk in [777, 4096] {
        let mut stitched = vec![];
        for start in (0..x.len()).step_by(chunk) {
            let end = (start + chunk).min(x.len());
            let a = start.saturating_sub(6144);
            let z = (end + 6144).min(x.len());
            let rendered = render_layers(&x[a..z], a as i64, 48000, 1, &layers, 2048).unwrap();
            stitched.extend_from_slice(&rendered[start - a..end - a]);
        }
        let error = whole
            .iter()
            .zip(stitched)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max);
        assert!(error < 1e-12, "chunk {chunk} error {error}");
    }
}
#[test]
fn source_edges_and_tiny_inputs_remain_finite() {
    for n in [1, 2, 17, 255, 2047, 2048, 2049, 4097] {
        let x = vec![0.25; n];
        let mut l = layer(None);
        l.mask.shape = Shape::Rectangle {
            start: 0.0,
            end: n as f64,
            low: 0.0,
            high: 24000.0,
        };
        let y = render_layers(&x, 0, 48000, 1, &[l], 2048).unwrap();
        assert_eq!(x.len(), y.len());
        assert!(y.iter().all(|x| x.is_finite()));
    }
}
#[test]
fn statistics_and_silent_correlation() {
    let mut a = StatisticsAccumulator::new(2).unwrap();
    a.push(&[0.0; 100]).unwrap();
    assert!(a.result().correlation.is_none());
    let mut a = StatisticsAccumulator::new(2).unwrap();
    a.push(&[0.5, -0.5, -0.5, 0.5]).unwrap();
    let s = a.result();
    assert_eq!(s.frames, 2);
    assert_eq!(s.channels[0].rms, 0.5);
    assert_eq!(s.channels[0].dc, 0.0);
    assert!((s.correlation.unwrap() + 1.0).abs() < 1e-12);
}
#[test]
fn monitor_identity_and_chunk_invariance() {
    let x = tone(5000, 48000.0, 1000.0);
    let y = monitor_resample(&x, 0, 100.0, 1000, 48000, 48000, 1).unwrap();
    assert!(y.iter().zip(&x[100..1100]).all(|(a, b)| *a == *b as f32));
    let all = monitor_resample(&x, 0, 100.0, 1500, 48000, 44100, 1).unwrap();
    let first = monitor_resample(&x, 0, 100.0, 777, 48000, 44100, 1).unwrap();
    let second = monitor_resample(
        &x,
        0,
        100.0 + 777.0 * 48000.0 / 44100.0,
        723,
        48000,
        44100,
        1,
    )
    .unwrap();
    assert!(all
        .iter()
        .zip(first.iter().chain(second.iter()))
        .all(|(a, b)| (a - b).abs() < 1e-6));
}
