use std::f64::consts::PI;
use tonalia_core::*;
fn layer(processor: Processor, start: f64, end: f64) -> Layer {
    Layer {
        id: "restoration".into(),
        name: "test".into(),
        enabled: true,
        gain_db: 0.0,
        processor: Some(processor),
        mask: Mask {
            shape: Shape::Rectangle {
                start,
                end,
                low: 0.0,
                high: 24000.0,
            },
            channel: Some(0),
            feather_time: 0.0,
            feather_hz: 0.0,
        },
    }
}
fn render(x: &[f64], layers: &[Layer]) -> Vec<f64> {
    render_layers(x, 0, 48000, 2, layers, 2048).unwrap()
}
fn input(frames: usize) -> Vec<f64> {
    (0..frames)
        .flat_map(|t| {
            let v = 0.2 * (2.0 * PI * 937.5 * t as f64 / 48000.0).sin();
            [v, -v]
        })
        .collect()
}
#[test]
fn gate_calibration_preserves_strong_tones_and_reduces_weak_noise() {
    let n = 48000;
    let x: Vec<_> = (0..n)
        .flat_map(|t| {
            let v = 0.2 * (2.0 * PI * 937.5 * t as f64 / 48000.0).sin()
                + 0.001 * (2.0 * PI * 6000.0 * t as f64 / 48000.0).sin();
            [v, -v]
        })
        .collect();
    let l = layer(
        Processor::SpectralGate {
            threshold_db: -40.0,
            reduction_db: 24.0,
        },
        0.0,
        n as f64,
    );
    validate_layers(&[l.clone()], n, 48000, 2).unwrap();
    let y = render(&x, &[l]);
    let projection = |v: &[f64], hz: f64| {
        (4096..n as usize - 4096)
            .map(|t| v[t * 2] * (2.0 * PI * hz * t as f64 / 48000.0).sin())
            .sum::<f64>()
            * 2.0
            / (n as f64 - 8192.0)
    };
    assert!((projection(&y, 937.5) - 0.2).abs() < 0.0003);
    assert!(projection(&y, 6000.0).abs() < 0.00015);
    for t in 0..n as usize {
        assert_eq!(x[t * 2 + 1], y[t * 2 + 1]);
    }
}
#[test]
fn interpolation_repairs_short_affine_gap_and_preserves_every_other_sample() {
    let mut x: Vec<_> = (0..5000).flat_map(|t| [t as f64 / 10000.0, 0.75]).collect();
    let original = x.clone();
    for t in 2000..2020 {
        x[t * 2] = 0.99;
    }
    let l = layer(Processor::Interpolate, 2000.0, 2020.0);
    validate_layers(&[l.clone()], 5000, 48000, 2).unwrap();
    let y = render(&x, &[l.clone()]);
    for t in 0..5000 {
        assert!((y[t * 2] - original[t * 2]).abs() < 1e-15);
        assert_eq!(y[t * 2 + 1], 0.75);
    }
    for (a, b) in [(0usize, 1800usize), (1900, 2100), (2100, 5000)] {
        let halo = render_halo(&[l.clone()]) as usize;
        let first = a.saturating_sub(halo);
        let last = (b + halo).min(5000);
        let part = render_layers(
            &x[first * 2..last * 2],
            first as i64,
            48000,
            2,
            &[l.clone()],
            2048,
        )
        .unwrap();
        assert_eq!(&part[(a - first) * 2..(b - first) * 2], &y[a * 2..b * 2]);
    }
}
#[test]
fn zero_strength_disabled_and_invalid_processors_are_handled() {
    let x = input(5000);
    for processor in [
        Processor::SpectralGate {
            threshold_db: -40.0,
            reduction_db: 0.0,
        },
        Processor::Hum {
            frequency: 50.0,
            width_hz: 23.4375,
            reduction_db: 0.0,
        },
        Processor::NeuralSpeechV1 { strength: 0.0 },
    ] {
        let mut l = layer(processor, 0.0, 5000.0);
        assert_eq!(x, render(&x, &[l.clone()]));
        l.enabled = false;
        assert_eq!(x, render(&x, &[l]));
    }
    assert!(validate_layers(&[layer(Processor::Interpolate, 0.0, 20.0)], 5000, 48000, 2).is_err());
    assert!(validate_layers(
        &[layer(Processor::Interpolate, 10.0, 1000.0)],
        5000,
        48000,
        2
    )
    .is_err());
    assert!(validate_layers(
        &[layer(
            Processor::NeuralSpeechV1 { strength: 0.8 },
            0.0,
            5000.0
        )],
        5000,
        44100,
        2
    )
    .is_err());
    assert!(validate_layers(
        &[layer(
            Processor::SpectralGate {
                threshold_db: f64::NAN,
                reduction_db: 10.0
            },
            0.0,
            5000.0
        )],
        5000,
        48000,
        2
    )
    .is_err());
}
#[test]
fn hum_attenuates_fundamental_and_harmonic() {
    let x: Vec<_> = (0..48000)
        .flat_map(|t| {
            [
                0.1 * (2.0 * PI * 93.75 * t as f64 / 48000.0).sin()
                    + 0.1 * (2.0 * PI * 187.5 * t as f64 / 48000.0).sin(),
                0.3,
            ]
        })
        .collect();
    let y = render(
        &x,
        &[layer(
            Processor::Hum {
                frequency: 93.75,
                width_hz: 23.4375,
                reduction_db: 30.0,
            },
            0.0,
            48000.0,
        )],
    );
    let energy = |v: &[f64]| (4096..43904).map(|t| v[t * 2].powi(2)).sum::<f64>();
    assert!(energy(&y) / energy(&x) < 0.2);
    assert!((0..48000).all(|t| y[t * 2 + 1] == 0.3));
}
#[test]
fn neural_is_finite_channel_scoped_and_chunk_independent_across_block_boundaries() {
    let x = input(500000);
    let l = layer(
        Processor::NeuralSpeechV1 { strength: 0.8 },
        30000.0,
        430000.0,
    );
    let y = render(&x, &[l.clone()]);
    assert!(y.iter().all(|v| v.is_finite()));
    assert!((0..500000).all(|t| y[t * 2 + 1] == x[t * 2 + 1]));
    assert_eq!(&y[..30000 * 2], &x[..30000 * 2]);
    assert_eq!(&y[430000 * 2..], &x[430000 * 2..]);
    let a = 250000usize;
    let b = 254000usize;
    let halo = render_halo(&[l.clone()]) as usize;
    let start = a.saturating_sub(halo);
    let end = (b + halo).min(500000);
    let crop = render_layers(&x[start * 2..end * 2], start as i64, 48000, 2, &[l], 2048).unwrap();
    for (a, b) in crop[(a - start) * 2..(b - start) * 2]
        .iter()
        .zip(&y[a * 2..b * 2])
    {
        assert!((a - b).abs() < 1e-12);
    }
    assert!(y.iter().zip(&x).any(|(a, b)| (a - b).abs() > 1e-5));
}
