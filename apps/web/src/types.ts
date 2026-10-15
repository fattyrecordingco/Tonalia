export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  float: boolean;
  frames: number;
  dataOffset: number;
  dataBytes: number;
  blockAlign: number;
  rf64: boolean;
}
export interface Point {
  sample: number;
  hz: number;
}
export type Shape =
  | { kind: 'rectangle'; start: number; end: number; low: number; high: number }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'brush'; points: Point[]; radiusTime: number; radiusHz: number; opacity: number };
export interface Mask {
  shape: Shape;
  channel: number | null;
  featherTime: number;
  featherHz: number;
}
export interface Layer {
  id: string;
  name: string;
  enabled: boolean;
  gainDb: number;
  mask: Mask;
}
export interface ChannelStats {
  peak: number;
  peakFrame: number;
  rms: number;
  dc: number;
  min: number;
  max: number;
  fullScaleSamples: number;
}
export interface Statistics {
  frames: number;
  channels: ChannelStats[];
  correlation: number | null;
}
export interface View {
  start: number;
  end: number;
  low: number;
  high: number;
  log: boolean;
}
export interface Analysis {
  waveform?: { peaks: Float32Array; binFrames: number; start: number };
  levels: Float32Array;
  columns: number;
  bins: number;
  start: number;
  hop: number;
  fftSize: number;
  channels: number;
  sampleRate: number;
}
export type Tool = 'time' | 'rectangle' | 'lasso' | 'brush' | 'hand';
export type Monitor = 'result' | 'original' | 'removed';
export type SourceRef =
  { kind: 'browser'; file: File } | { kind: 'native'; id: string; name: string; size: number };
export interface ScanEvent {
  progress: number;
  binStart: number;
  binFrames: number;
  peaks: Float32Array;
  stats: Statistics;
  fingerprint?: string;
}
export interface Project {
  format: 'tonalia';
  schema: 1;
  engine: 'spectral-gain-v1';
  fftSize: 2048;
  source: {
    name: string;
    size: number;
    sha256: string;
    sampleRate: number;
    channels: number;
    frames: number;
  };
  layers: Layer[];
  view: View;
}
export const EDIT_FFT = 2048;
export const isNative = () => '__TAURI_INTERNALS__' in window;
export function maskBounds(mask: Mask): { start: number; end: number; low: number; high: number } {
  const s = mask.shape;
  if (s.kind === 'rectangle') return s;
  const p = s.points;
  const rt = s.kind === 'brush' ? s.radiusTime : 0;
  const rf = s.kind === 'brush' ? s.radiusHz : 0;
  return {
    start: Math.min(...p.map((p) => p.sample)) - rt,
    end: Math.max(...p.map((p) => p.sample)) + rt,
    low: Math.min(...p.map((p) => p.hz)) - rf,
    high: Math.max(...p.map((p) => p.hz)) + rf,
  };
}
export const db = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity);
export const formatDb = (value: number) => (value > 0 ? `${db(value).toFixed(1)} dBFS` : '−∞ dBFS');
export const formatHz = (hz: number) =>
  hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${Math.round(hz)}`;
export function formatTime(seconds: number, precision = 3) {
  if (!Number.isFinite(seconds)) return '0:00.000';
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) - m * 60;
  return `${m}:${s.toFixed(precision).padStart(precision ? 3 + precision : 2, '0')}`;
}
