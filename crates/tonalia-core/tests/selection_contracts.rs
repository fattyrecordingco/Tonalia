use tonalia_core::{
    spectral::{SelectionMode, SelectionOperation},
    *,
};

fn rectangle(start: f64, end: f64, channel: Option<u16>) -> Mask {
    Mask {
        shape: Shape::Rectangle {
            start,
            end,
            low: 0.0,
            high: 24000.0,
        },
        channel,
        feather_time: 0.0,
        feather_hz: 0.0,
    }
}
fn op(mode: SelectionMode, mask: Mask) -> SelectionOperation {
    SelectionOperation { mode, mask }
}
fn layer(operations: Vec<SelectionOperation>) -> Layer {
    Layer {
        id: "combined".into(),
        name: "Mixed tools".into(),
        enabled: true,
        gain_db: -18.0,
        processor: None,
        mask: Mask {
            shape: Shape::Composite { operations },
            channel: None,
            feather_time: 0.0,
            feather_hz: 0.0,
        },
    }
}
#[test]
fn ordered_add_erase_and_repaint_preserve_weights_channels_and_gaps() {
    let brush = |sample, opacity| Mask {
        shape: Shape::Brush {
            points: vec![Point { sample, hz: 1000.0 }],
            radius_time: 600.0,
            radius_hz: 300.0,
            opacity,
            hardness: Some(1.0),
        },
        channel: Some(0),
        feather_time: 0.0,
        feather_hz: 0.0,
    };
    let l = layer(vec![
        op(SelectionMode::Add, brush(2000.0, 0.7)),
        op(SelectionMode::Add, brush(8000.0, 0.4)),
        op(SelectionMode::Subtract, brush(2000.0, 0.5)),
    ]);
    validate_layers(&[l.clone()], 12000, 48000, 2).unwrap();
    assert!((l.mask.weight(2000.0, 1000.0, 0) - 0.35).abs() < 1e-14);
    assert_eq!(l.mask.weight(5000.0, 1000.0, 0), 0.0); // No connecting line between strokes.
    assert_eq!(l.mask.weight(8000.0, 1000.0, 0), 0.4);
    assert_eq!(l.mask.weight(2000.0, 1000.0, 1), 0.0);
    let mut painted = l.clone();
    if let Shape::Composite { operations } = &mut painted.mask.shape {
        operations.push(op(SelectionMode::Add, brush(2000.0, 0.8)));
    }
    assert_eq!(painted.mask.weight(2000.0, 1000.0, 0), 0.8);
    let json = serde_json::to_string(&painted).unwrap();
    let restored: Layer = serde_json::from_str(&json).unwrap();
    assert_eq!(restored.mask.weight(2000.0, 1000.0, 0), 0.8);
}
#[test]
fn rendered_eraser_hole_and_disjoint_strokes_leave_original_audio_untouched() {
    let frames = 48000;
    let input: Vec<_> = (0..frames)
        .flat_map(|i| {
            let x = (i as f64 * std::f64::consts::TAU * 937.5 / 48000.0).sin() * 0.5;
            [x, -x]
        })
        .collect();
    let l = layer(vec![
        op(SelectionMode::Add, rectangle(4000.0, 17000.0, Some(0))),
        op(SelectionMode::Add, rectangle(30000.0, 42000.0, Some(0))),
        op(SelectionMode::Subtract, rectangle(9000.0, 13000.0, Some(0))),
    ]);
    validate_layers(&[l.clone()], frames as u64, 48000, 2).unwrap();
    let output = render_layers(&input, 0, 48000, 2, &[l.clone()], 2048).unwrap();
    let gain = 10f64.powf(-18.0 / 20.0);
    for i in 0..frames {
        assert_eq!(
            output[i * 2 + 1],
            input[i * 2 + 1],
            "unselected channel at {i}"
        );
        if (10500..11500).contains(&i) || (20000..26000).contains(&i) || i < 2000 || i > 44000 {
            assert_eq!(output[i * 2], input[i * 2], "erased hole / gap at {i}");
        }
        if (6000..7500).contains(&i) || (33000..38000).contains(&i) {
            assert!((output[i * 2] - gain * input[i * 2]).abs() < 1e-12);
        }
    }
    // A chunk cut through a selection must match the full render (with FFT halo).
    let start = 18000usize;
    let end = 35000usize;
    let halo = 2048usize;
    let chunk = render_layers(
        &input[(start - halo) * 2..(end + halo) * 2],
        (start - halo) as i64,
        48000,
        2,
        &[l],
        2048,
    )
    .unwrap();
    for i in start..end {
        assert!((output[i * 2] - chunk[(i - start + halo) * 2]).abs() < 1e-12);
    }
}
#[test]
fn nested_or_unbounded_selection_programs_are_rejected() {
    let nested = layer(vec![op(
        SelectionMode::Add,
        layer(vec![op(SelectionMode::Add, rectangle(1.0, 1000.0, None))]).mask,
    )]);
    assert!(validate_layers(&[nested], 48000, 48000, 2)
        .unwrap_err()
        .contains("Nested"));
    let huge = layer(
        (0..129)
            .map(|_| op(SelectionMode::Add, rectangle(1.0, 1000.0, None)))
            .collect(),
    );
    assert!(validate_layers(&[huge], 48000, 48000, 2).is_err());
    assert!(validate_layers(
        &[layer(vec![op(
            SelectionMode::Subtract,
            rectangle(1.0, 1000.0, None)
        )])],
        48000,
        48000,
        2
    )
    .is_err());
    let bad_channel = layer(vec![op(
        SelectionMode::Add,
        rectangle(1.0, 1000.0, Some(2)),
    )]);
    assert!(validate_layers(&[bad_channel], 48000, 48000, 2).is_err());
}
