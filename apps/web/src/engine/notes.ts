// Equal temperament, scientific pitch notation (middle C = C4 = MIDI 60).
export const noteHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
export const noteName = (midi: number) =>
  `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export function identifyNote(hz: number) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const pitch = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(pitch);
  if (midi < 0 || midi > 127) return null;
  return { midi, name: noteName(midi), cents: Math.round((pitch - midi) * 100) };
}
export interface DetectedNote {
  start: number;
  end: number;
  midi: number;
  hz: number;
  confidence: number;
  velocity: number;
  channel: number;
}
export interface NoteConversion {
  notes: DetectedNote[];
  start: number;
  end: number;
  sampleRate: number;
  signal: 'original' | 'result';
}
export interface NoteRequest {
  start: number;
  end: number;
  channel: number | null;
  signal: 'original' | 'result';
  thresholdDb: number;
}
export const PITCH_RATE = 12000;
export const PITCH_WINDOW = 1024;
export const PITCH_HOP = 240; // 20 ms, independent of display resolution and zoom.
export interface Pitch {
  hz: number;
  midi: number;
  confidence: number;
  rms: number;
}
// YIN difference and cumulative mean normalization, followed by the first
// trough below 0.15 and parabolic refinement. de Cheveigné & Kawahara (2002):
// https://doi.org/10.1121/1.1458024. Detection range C1–C7, A4 = 440 Hz.
export function detectPitch(frame: Float32Array, thresholdDb: number): Pitch | null {
  let mean = 0;
  for (let i = 256; i < 768; i++) mean += frame[i];
  mean /= 512;
  let energy = 0;
  for (let i = 256; i < 768; i++) energy += (frame[i] - mean) ** 2;
  const rms = Math.sqrt(energy / 512);
  if (rms < 10 ** (thresholdDb / 20) || rms < 1e-8) return null;
  const maxLag = Math.ceil(PITCH_RATE / noteHz(24)) + 1;
  const difference = new Float64Array(maxLag + 1);
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let value = 0;
    for (let j = 0; j < 512; j++) value += (frame[j] - frame[j + lag]) ** 2;
    sum += value;
    difference[lag] = sum > 0 ? (value * lag) / sum : 1;
  }
  for (let lag = Math.max(2, Math.floor(PITCH_RATE / noteHz(96))); lag < maxLag; lag++) {
    if (difference[lag] >= 0.15) continue;
    while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
    const a = difference[lag - 1],
      b = difference[lag],
      c = difference[lag + 1];
    const denominator = a - 2 * b + c;
    const shift = denominator ? Math.max(-1, Math.min(1, (a - c) / (2 * denominator))) : 0;
    const hz = PITCH_RATE / (lag + shift);
    const note = identifyNote(hz);
    if (!note || note.midi < 24 || note.midi > 96) return null;
    return { hz, midi: note.midi, confidence: Math.max(0, 1 - b), rms };
  }
  return null;
}

// Two consecutive frames confirm a transition. A single uncertain frame does
// not split a sustained note; trailing silence is excluded from its duration.
export class NoteTracker {
  readonly notes: DetectedNote[] = [];
  private active: { note: DetectedNote; count: number; rms: number } | null = null;
  private candidate: { pitch: Pitch | null; start: number; end: number; count: number } | null =
    null;
  constructor(
    private channel: number,
    private minimumFrames: number,
  ) {}
  push(pitch: Pitch | null, start: number, end: number) {
    if (this.active && pitch?.midi === this.active.note.midi) {
      const a = this.active;
      a.note.end = end;
      a.note.hz = (a.note.hz * a.count + pitch.hz) / (a.count + 1);
      a.note.confidence = (a.note.confidence * a.count + pitch.confidence) / (a.count + 1);
      a.rms = (a.rms * a.count + pitch.rms) / (a.count + 1);
      a.count++;
      this.candidate = null;
      return;
    }
    if (this.candidate && this.candidate.pitch?.midi === pitch?.midi) {
      this.candidate.count++;
      this.candidate.end = end;
    } else this.candidate = { pitch, start, end, count: 1 };
    if (this.candidate.count < 2) return;
    this.flush();
    const c = this.candidate;
    if (c.pitch)
      this.active = {
        note: {
          start: c.start,
          end: c.end,
          midi: c.pitch.midi,
          hz: c.pitch.hz,
          confidence: c.pitch.confidence,
          velocity: 1,
          channel: this.channel,
        },
        count: c.count,
        rms: c.pitch.rms,
      };
    this.candidate = null;
  }
  flush() {
    const a = this.active;
    if (a && a.note.end - a.note.start >= this.minimumFrames) {
      a.note.velocity = Math.max(1, Math.min(127, Math.round(127 * Math.sqrt(a.rms))));
      this.notes.push(a.note);
    }
    this.active = null;
  }
}
