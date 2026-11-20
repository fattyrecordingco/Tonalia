import type { NoteConversion } from './notes';

function variable(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fffffff)
    throw new Error('MIDI event time exceeds the supported range.');
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
  return bytes;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (id: string, bytes: number[]) =>
  Array.from(id, (c) => c.charCodeAt(0)).concat(u32(bytes.length), bytes);
// Standard MIDI file type 1. 120 BPM and 960 PPQ preserve real-time timing;
// this is a time base, not a tempo estimate. Each source channel gets a track.
export function encodeMidi(conversion: NoteConversion): Uint8Array {
  if (!conversion.notes.length) throw new Error('Convert audio to notes before exporting MIDI.');
  const channels = [...new Set(conversion.notes.map((n) => n.channel))].sort();
  const tracks: number[][] = [chunk('MTrk', [0, 255, 81, 3, 7, 161, 32, 0, 255, 47, 0])];
  const tick = (sample: number) =>
    Math.max(0, Math.round(((sample - conversion.start) / conversion.sampleRate) * 1920));
  for (const ch of channels) {
    const name = new TextEncoder().encode(
      `Tonalia ${channels.length === 1 ? 'notes' : ch === 0 ? 'left' : 'right'}`,
    );
    const bytes = [0, 255, 3, ...variable(name.length), ...name];
    const events: { at: number; off: boolean; midi: number; velocity: number }[] = [];
    for (const note of conversion.notes.filter((n) => n.channel === ch)) {
      const at = tick(note.start);
      events.push({ at, off: false, midi: note.midi, velocity: note.velocity });
      events.push({
        at: Math.max(at + 1, tick(note.end)),
        off: true,
        midi: note.midi,
        velocity: 0,
      });
    }
    events.sort((a, b) => a.at - b.at || Number(b.off) - Number(a.off) || a.midi - b.midi);
    let previous = 0;
    for (const event of events) {
      bytes.push(
        ...variable(event.at - previous),
        (event.off ? 0x80 : 0x90) | ch,
        event.midi,
        event.velocity,
      );
      previous = event.at;
    }
    bytes.push(...variable(Math.max(0, tick(conversion.end) - previous)), 255, 47, 0);
    tracks.push(chunk('MTrk', bytes));
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length, 3, 192]);
  const size = header.length + tracks.reduce((n, t) => n + t.length, 0);
  const result = new Uint8Array(size);
  result.set(header);
  let offset = header.length;
  for (const track of tracks) {
    result.set(track, offset);
    offset += track.length;
  }
  return result;
}
