import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  Analysis,
  Layer,
  Monitor,
  SourceRef,
  WavInfo,
  ScanEvent,
  Project,
  View,
} from '../types';
import { isNative } from '../types';

interface WritableAudio {
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
}
interface AudioPicker {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}
interface PickerWindow extends Window {
  showSaveFilePicker?: (
    options: AudioPicker,
  ) => Promise<{ name: string; createWritable: () => Promise<WritableAudio> }>;
}
export class AudioEngine {
  private worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (x: unknown) => void; reject: (e: Error) => void }
  >();
  private listeners: UnlistenFn[] = [];
  private writer: WritableAudio | null = null;
  private context: AudioContext | null = null;
  private player: AudioWorkletNode | null = null;
  private generation = 0;
  private playing = false;
  private source: SourceRef | null = null;
  private info: WavInfo | null = null;
  private session = '';
  private nextPosition = 0;
  private queue = 0;
  private filling = false;
  private request: {
    start: number;
    end: number;
    mode: Monitor;
    layers: Layer[];
    loop: boolean;
  } | null = null;
  onScan: (x: ScanEvent) => void = () => {};
  onFingerprint: (x: string) => void = () => {};
  onAnalysisProgress: (x: number) => void = () => {};
  onExportProgress: (x: number) => void = () => {};
  onPosition: (position: number, playing: boolean, peak?: number) => void = () => {};
  onError: (e: string) => void = () => {};
  onDevice: (details: {
    name: string;
    sampleRate: number;
    backend: string;
    channels: number;
  }) => void = () => {};
  constructor() {
    this.worker.onmessage = (e) => void this.message(e.data);
    this.worker.onerror = (e) => {
      for (const p of this.pending.values())
        p.reject(new Error(e.message || 'Audio worker failed'));
      this.pending.clear();
      this.onError('The audio worker stopped. Reopen the source to restart analysis.');
    };
  }
  async init() {
    if (isNative()) {
      this.listeners.push(
        await listen<{ session: string; position: number; playing: boolean; underruns: number }>(
          'audio-position',
          (e) => {
            if (e.payload.session === this.session) {
              this.playing = e.payload.playing;
              this.onPosition(e.payload.position, e.payload.playing);
            }
          },
        ),
      );
      this.listeners.push(
        await listen<{ session: string; error: string }>('audio-error', (e) => {
          if (e.payload.session === this.session) this.onError(e.payload.error);
        }),
      );
      this.listeners.push(
        await listen<number>('export-progress', (e) => this.onExportProgress(e.payload)),
      );
    }
  }
  private async message(msg: Record<string, unknown>) {
    if (msg.event === 'read') {
      try {
        const bytes = await invoke<ArrayBuffer | number[]>('read_source_range', {
          id: msg.sourceId,
          offset: msg.start,
          length: msg.length,
        });
        const buffer = bytes instanceof ArrayBuffer ? bytes : new Uint8Array(bytes).buffer;
        this.worker.postMessage({ event: 'readResult', id: msg.id, bytes: buffer }, [buffer]);
      } catch (e) {
        this.worker.postMessage({ event: 'readResult', id: msg.id, error: String(e) });
      }
      return;
    }
    if (msg.event === 'write') {
      try {
        if (!this.writer) throw new Error('Output is no longer available.');
        await this.writer.write(msg.bytes as Uint8Array);
        this.worker.postMessage({ event: 'writeResult', id: msg.id });
      } catch (e) {
        this.worker.postMessage({ event: 'writeResult', id: msg.id, error: String(e) });
      }
      return;
    }
    if (msg.event === 'scan') {
      this.onScan(msg as unknown as ScanEvent);
      return;
    }
    if (msg.event === 'fingerprint') {
      this.onFingerprint(msg.fingerprint as string);
      return;
    }
    if (msg.event === 'scanError') {
      this.onError(msg.error as string);
      return;
    }
    if (msg.event === 'analysisProgress') {
      this.onAnalysisProgress(msg.progress as number);
      return;
    }
    if (msg.event === 'exportProgress') {
      this.onExportProgress(msg.progress as number);
      return;
    }
    const pending = this.pending.get(msg.id as number);
    if (!pending) return;
    this.pending.delete(msg.id as number);
    if (msg.error) pending.reject(new Error(msg.error as string));
    else pending.resolve(msg.value);
  }
  call<T>(method: string, args: unknown): Promise<T> {
    const id = ++this.next;
    const result = new Promise<T>((resolve, reject) =>
      this.pending.set(id, { resolve: resolve as (x: unknown) => void, reject }),
    );
    this.worker.postMessage({ id, method, args });
    return result;
  }
  cancelAnalysis() {
    this.worker.postMessage({ method: 'cancelAnalysis' });
  }
  async chooseNativeSource(): Promise<SourceRef | null> {
    const path = await open({
      multiple: false,
      filters: [{ name: 'WAV audio', extensions: ['wav', 'wave'] }],
    });
    if (typeof path !== 'string') return null;
    return invoke<SourceRef>('open_source', { path });
  }
  async discardCandidate(source: SourceRef) {
    if (!isNative() || source.kind !== 'native') return;
    if (this.source?.kind === 'native' && this.source.id === source.id) return;
    await invoke('release_source', { id: source.id }).catch(() => {});
  }
  async load(source: SourceRef) {
    await this.stop();
    try {
      const info = await this.call<WavInfo>('open', { source });
      const previous = this.source;
      this.source = source;
      this.info = info;
      if (previous) await this.discardCandidate(previous);
      return info;
    } catch (error) {
      await this.discardCandidate(source);
      throw error;
    }
  }
  analyze(view: View, fftSize: number, layers: Layer[], columns = 900) {
    return this.call<Analysis | null>('analyze', { view, fftSize, layers, columns });
  }
  async play(
    position: number,
    end: number,
    layers: Layer[],
    mode: Monitor,
    volume: number,
    loop: boolean,
  ) {
    await this.stop();
    if (!this.info || !this.source) return;
    this.session = crypto.randomUUID();
    const own = this.generation;
    this.request = { start: position, end, layers: structuredClone(layers), mode, loop };
    this.nextPosition = position;
    this.queue = 0;
    this.filling = false;
    if (isNative() && this.source.kind === 'native') {
      const device = await invoke<{
        name: string;
        sampleRate: number;
        backend: string;
        channels: number;
      }>('play_audio', {
        id: this.source.id,
        request: {
          session: this.session,
          position: Math.floor(position),
          end: Math.floor(end),
          layers,
          mode,
          volume,
          looping: loop,
        },
      });
      if (own !== this.generation) return;
      this.playing = true;
      this.onDevice(device);
      return;
    }
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      await this.context.audioWorklet.addModule('/audio-processor.js');
    }
    if (own !== this.generation) return;
    await this.context.resume();
    const player = new AudioWorkletNode(this.context, 'tonalia-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [this.info.channels],
    });
    this.player = player;
    player.connect(this.context.destination);
    player.port.postMessage({ type: 'gain', value: volume });
    player.port.onmessage = (e) => {
      if (own !== this.generation) return;
      const msg = e.data;
      const req = this.request;
      if (!req || !this.info || !this.context) return;
      if (msg.type === 'need') {
        this.queue--;
        void this.fill(own).catch((e) => this.onError(String(e)));
      }
      if (msg.type === 'position' || msg.type === 'ended') {
        let at = req.start + (msg.frames * this.info.sampleRate) / this.context.sampleRate;
        if (req.loop) at = req.start + ((at - req.start) % (req.end - req.start));
        this.onPosition(Math.min(at, req.end), msg.type !== 'ended', msg.peak);
        if (msg.type === 'ended') {
          this.playing = false;
        }
      }
      if (msg.type === 'underrun') {
        this.playing = false;
        this.onPosition(this.nextPosition, false);
        this.onError(
          'Playback stopped after an audio underrun. Try a shorter preview or fewer layers.',
        );
      }
    };
    await this.fill(own);
    if (own !== this.generation) return;
    player.port.postMessage({ type: 'run' });
    this.playing = true;
    this.onDevice({
      name: 'System output',
      sampleRate: this.context.sampleRate,
      channels: this.info.channels,
      backend: 'Web Audio / Rust WASM',
    });
  }
  private async fill(own: number) {
    if (this.filling) return;
    this.filling = true;
    try {
      while (
        this.queue < 3 &&
        own === this.generation &&
        this.player &&
        this.request &&
        this.info &&
        this.context
      ) {
        const req = this.request;
        if (this.nextPosition >= req.end) {
          if (req.loop) this.nextPosition = req.start;
          else {
            this.player.port.postMessage({ type: 'end' });
            break;
          }
        }
        const result = await this.call<{ samples: Float32Array; frames: number }>('playback', {
          position: this.nextPosition,
          count: 16384,
          deviceRate: this.context.sampleRate,
          layers: req.layers,
          mode: req.mode,
          end: req.end,
        });
        if (own !== this.generation) return;
        if (!result.frames) {
          this.player?.port.postMessage({ type: 'end' });
          break;
        }
        this.nextPosition += (result.frames * this.info.sampleRate) / this.context.sampleRate;
        this.queue++;
        this.player.port.postMessage(
          { type: 'chunk', samples: result.samples, channels: this.info.channels },
          [result.samples.buffer],
        );
      }
    } finally {
      if (own === this.generation) this.filling = false;
    }
  }
  async stop() {
    this.generation++;
    this.session = '';
    this.playing = false;
    this.player?.port.postMessage({ type: 'stop' });
    this.player?.disconnect();
    this.player = null;
    this.queue = 0;
    this.filling = false;
    if (isNative()) await invoke('stop_audio');
  }
  setVolume(volume: number) {
    this.player?.port.postMessage({ type: 'gain', value: volume });
    if (isNative()) void invoke('set_volume', { volume }).catch((e) => this.onError(String(e)));
  }
  cancelExport() {
    this.worker.postMessage({ method: 'cancelExport' });
    if (isNative()) void invoke('cancel_export');
  }
  async export(name: string, layers: Layer[], start: number, end: number, bits: number) {
    if (!this.info || !this.source) throw new Error('Open an audio source first.');
    const suggestedName = name.replace(/\.[^.]+$/, '') + '-tonalia.wav';
    if (isNative() && this.source.kind === 'native') {
      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'WAV audio', extensions: ['wav'] }],
      });
      if (!path) return null;
      return invoke<{ frames: number; peak: number }>('export_audio', {
        id: this.source.id,
        request: { path, layers, start: Math.floor(start), end: Math.floor(end), bits },
      });
    }
    const picker = (window as PickerWindow).showSaveFilePicker;
    let parts: BlobPart[] = [];
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }],
        });
        if (
          handle.name.normalize('NFC').toLocaleLowerCase() ===
          name.normalize('NFC').toLocaleLowerCase()
        ) {
          throw new Error(
            'Choose a different filename. Tonalia does not overwrite the source audio.',
          );
        }
        this.writer = await handle.createWritable();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return null;
        throw e;
      }
    } else {
      const size = (end - start) * this.info.channels * (bits / 8) + 80;
      if (size > 256 * 1024 * 1024)
        throw new Error(
          'This browser cannot stream directly to disk. Export a range smaller than 256 MiB, or use Tonalia desktop.',
        );
      this.writer = {
        write: async (b) => {
          parts.push(b.slice() as BlobPart);
        },
        close: async () => download(new Blob(parts, { type: 'audio/wav' }), suggestedName),
        abort: async () => {
          parts = [];
        },
      };
    }
    try {
      const result = await this.call<{ frames: number; peak: number }>('export', {
        layers,
        start,
        end,
        bits,
      });
      await this.writer.close();
      return result;
    } catch (e) {
      await this.writer.abort().catch(() => {});
      throw e;
    } finally {
      this.writer = null;
    }
  }
  async saveProject(project: Project) {
    const text = JSON.stringify(project, null, 2);
    const name = project.source.name.replace(/\.[^.]+$/, '') + '.tonalia.json';
    if (isNative()) {
      const path = await save({
        defaultPath: name,
        filters: [{ name: 'Tonalia project', extensions: ['json'] }],
      });
      if (!path) return false;
      await invoke('save_project', { path, contents: text });
    } else download(new Blob([text], { type: 'application/json' }), name);
    return true;
  }
  async chooseProject(): Promise<string | null> {
    if (!isNative()) return null;
    const path = await open({
      multiple: false,
      filters: [{ name: 'Tonalia project', extensions: ['json'] }],
    });
    return typeof path === 'string' ? invoke<string>('read_project', { path }) : null;
  }
  dispose() {
    void this.stop();
    for (const fn of this.listeners) fn();
    this.worker.terminate();
    void this.context?.close();
  }
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function calibrationFile(): File {
  const rate = 48000,
    frames = rate * 18,
    channels = 2;
  const buffer = new ArrayBuffer(44 + frames * channels * 4);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  text(36, 'data');
  view.setUint32(40, frames * channels * 4, true);
  let seed = 17;
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296 - 0.5) * 0.006;
    const envelope = Math.min(1, t * 5, (18 - t) * 5) * (0.6 + 0.4 * Math.sin(t * 0.7) ** 2);
    const fundamental = 110 * Math.pow(2, (Math.floor(t / 3) % 4) / 12);
    let harmonic = 0;
    for (let k = 1; k <= 18; k++)
      harmonic += (Math.sin(2 * Math.PI * fundamental * k * t) / (k * k ** 0.1)) * 0.13;
    const whistle =
      t > 6 && t < 11
        ? 0.055 * Math.sin(2 * Math.PI * 3000 * t) * Math.min(1, (t - 6) * 20, (11 - t) * 20)
        : 0;
    const click = Math.abs(t - 4.35) < 0.00006 ? 0.35 : 0;
    const chirp =
      t > 12 ? 0.025 * Math.sin(2 * Math.PI * (6000 * (t - 12) + 200 * (t - 12) ** 2)) : 0;
    const body = harmonic * envelope + noise + whistle + click + chirp;
    view.setFloat32(44 + i * 8, body, true);
    view.setFloat32(
      48 + i * 8,
      body * 0.92 + 0.013 * Math.sin(2 * Math.PI * 173 * t) * envelope,
      true,
    );
  }
  return new File([buffer], 'Calibration · harmonic study.wav', { type: 'audio/wav' });
}
