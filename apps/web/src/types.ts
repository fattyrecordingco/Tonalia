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
export type PrimitiveShape =
  | { kind: 'rectangle'; start: number; end: number; low: number; high: number }
  | { kind: 'polygon'; points: Point[] }
  | {
      kind: 'brush';
      points: Point[];
      radiusTime: number;
      radiusHz: number;
      opacity: number;
      hardness?: number;
    };
export type Shape = PrimitiveShape | { kind: 'composite'; operations: SelectionOperation[] };
export interface SelectionOperation {
  mode: 'add' | 'subtract';
  mask: Mask & { shape: PrimitiveShape };
}
export interface Mask {
  shape: Shape;
  channel: number | null;
  featherTime: number;
  featherHz: number;
}
export type Processor =
  | { kind: 'noiseReduction'; profileDb: number[]; reductionDb: number; sensitivityDb: number }
  | { kind: 'spectralGate'; thresholdDb: number; reductionDb: number }
  | { kind: 'hum'; frequency: number; widthHz: number; reductionDb: number }
  | { kind: 'interpolate' }
  | { kind: 'neuralSpeechV1'; strength: number };
export interface Layer {
  id: string;
  name: string;
  enabled: boolean;
  gainDb: number;
  processor?: Processor;
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
export type Tool = 'time' | 'rectangle' | 'lasso' | 'brush' | 'eraser' | 'hand';
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
  schema: 1 | 2 | 3;
  engine: 'spectral-gain-v1' | 'spectral-edit-v2' | 'spectral-edit-v3';
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
  if (s.kind === 'composite') {
    const bounds = s.operations.filter((op) => op.mode === 'add').map((op) => maskBounds(op.mask));
    return {
      start: Math.min(...bounds.map((b) => b.start)),
      end: Math.max(...bounds.map((b) => b.end)),
      low: Math.min(...bounds.map((b) => b.low)),
      high: Math.max(...bounds.map((b) => b.high)),
    };
  }
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

// Ordered edits preserve separate stroke geometry: lifting the brush never joins strokes.
export function combineSelection(
  base: Mask | null,
  mask: Mask & { shape: PrimitiveShape },
  mode: SelectionOperation['mode'],
): Mask | null {
  if (!base) return mode === 'subtract' ? null : mask;
  const operations: SelectionOperation[] =
    base.shape.kind === 'composite'
      ? base.shape.operations
          .filter(
            (op) =>
              base.channel === null || op.mask.channel === null || op.mask.channel === base.channel,
          )
          .map((op) => ({
            ...op,
            mask: { ...op.mask, channel: base.channel ?? op.mask.channel },
          }))
      : [{ mode: 'add', mask: base as Mask & { shape: PrimitiveShape } }];
  while (operations.length && operations[0].mode === 'subtract') operations.shift();
  if (!operations.length) return mode === 'subtract' ? null : mask;
  return {
    shape: { kind: 'composite', operations: [...operations, { mode, mask }] },
    channel: null,
    featherTime: 0,
    featherHz: 0,
  };
}
export function selectionBudget(mask: Mask): boolean {
  const operations = mask.shape.kind === 'composite' ? mask.shape.operations : [{ mask }];
  return (
    operations.length <= 128 &&
    operations.reduce(
      (n, { mask }) => n + ('points' in mask.shape ? mask.shape.points.length : 0),
      0,
    ) <= 32768
  );
}
