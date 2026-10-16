use std::time::Instant;
use tonalia_core::{render_layers, Layer};
fn main() {
    let rate = 44100;
    let frames = 65536;
    let pcm: Vec<f64> = (0..frames)
        .flat_map(|i| {
            let v = (i as f64 * 0.13).sin() * 0.1;
            [v, -v]
        })
        .collect();
    let layers: Vec<Layer> = (0..7).map(|i| serde_json::from_value(serde_json::json!({
        "id":format!("brush-{i}"),"name":"Dense brush","enabled":true,"gainDb":-6,
        "mask":{"shape":{"kind":"brush","points":(0..512).map(|p| serde_json::json!({"sample":p as f64 * frames as f64 / 511.,"hz":600. + i as f64 * 800. + (p as f64 * 0.03).sin() * 300.})).collect::<Vec<_>>(),"radiusTime":4000.,"radiusHz":180.,"opacity":0.7,"hardness":0.5},"channel":null,"featherTime":0,"featherHz":0}
    })).unwrap()).collect();
    let start = Instant::now();
    let out = render_layers(&pcm, 0, rate, 2, &layers, 2048).unwrap();
    println!("{{\"renderSeconds\":{},\"audioSeconds\":{},\"layers\":7,\"pointsPerStroke\":512,\"finite\":{}}}",start.elapsed().as_secs_f64(), frames as f64 / rate as f64, out.iter().all(|x|x.is_finite()));
}
