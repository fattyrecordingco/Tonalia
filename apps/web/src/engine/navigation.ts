import type { View } from '../types';
export function clampView(v: View, frames: number): View {
  const span = Math.min(frames, Math.max(64, v.end - v.start));
  const start = Math.max(0, Math.min(frames - span, v.start));
  return { ...v, start, end: start + span };
}
export function zoomTime(v: View, frames: number, factor: number, fraction = 0.5): View {
  fraction = Math.max(0, Math.min(1, fraction));
  const anchor = v.start + fraction * (v.end - v.start);
  const span = Math.min(frames, Math.max(64, (v.end - v.start) * factor));
  return clampView(
    { ...v, start: anchor - span * fraction, end: anchor + span * (1 - fraction) },
    frames,
  );
}
export function zoomFrequency(v: View, nyquist: number, factor: number, fraction: number): View {
  const min = v.log ? Math.min(20, nyquist / 2) : 0;
  const transform = (x: number) => (v.log ? Math.log(x) : x);
  const inverse = (x: number) => (v.log ? Math.exp(x) : x);
  const bottom = transform(min),
    top = transform(nyquist);
  fraction = Math.max(0, Math.min(1, fraction));
  const low = transform(Math.max(min, v.low)),
    high = transform(Math.min(nyquist, v.high));
  const span = Math.min(top - bottom, Math.max(v.log ? 0.005 : 1, (high - low) * factor));
  const anchor = low + fraction * (high - low);
  const next = Math.max(bottom, Math.min(top - span, anchor - fraction * span));
  return { ...v, low: Math.max(min, inverse(next)), high: Math.min(nyquist, inverse(next + span)) };
}
export function panFrequency(v: View, nyquist: number, fraction: number): View {
  const min = v.log ? Math.min(20, nyquist / 2) : 0;
  const low = v.log ? Math.log(Math.max(min, v.low)) : v.low;
  const high = v.log ? Math.log(v.high) : v.high;
  const bottom = v.log ? Math.log(min) : min;
  const top = v.log ? Math.log(nyquist) : nyquist;
  const span = Math.min(top - bottom, high - low);
  const next = Math.max(bottom, Math.min(top - span, low + fraction * span));
  return {
    ...v,
    low: Math.max(min, v.log ? Math.exp(next) : next),
    high: Math.min(nyquist, v.log ? Math.exp(next + span) : next + span),
  };
}
