//! Shared, source-preserving audio mathematics. No hardware, UI, or filesystem dependencies.
pub mod resample;
pub mod restoration;
pub use restoration::{render_halo, Processor};
pub mod spectral;
pub mod stats;
pub mod wav;
pub use spectral::{render_layers, validate_layers, Analyzer, Layer, Mask, Point, Shape};
pub use wav::{decode_frames, encode_float, float_wav_header, inspect_wav, WavInfo};
