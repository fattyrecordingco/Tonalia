/// <reference lib="webworker" />
import init, {
  inspect,
  decode,
  Spectrum,
  render,
  resample,
  Scan,
  peak_bins,
  wav_header,
  encode,
  validate,
} from '../wasm/tonalia_wasm';
import type { WavInfo, SourceRef, Layer, Analysis, Monitor } from '../types';
const ready = init();
let source: SourceRef | null = null,
  info: WavInfo | null = null,
  epoch = 0,
  viewEpoch = 0,
  exportEpoch = 0,
  openEpoch = 0;
let ioId = 0;
const pendingReads = new Map<
  number,
  { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }
>();
const pendingWrites = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
const delay = () => new Promise<void>((r) => setTimeout(r, 0));
function error(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
async function readRef(ref: SourceRef, start: number, end: number): Promise<Uint8Array> {
  if (ref.kind === 'browser') return new Uint8Array(await ref.file.slice(start, end).arrayBuffer());
  const id = ++ioId;
  const result = new Promise<ArrayBuffer>((resolve, reject) =>
    pendingReads.set(id, { resolve, reject }),
  );
  self.postMessage({ event: 'read', id, sourceId: ref.id, start, length: end - start });
  return new Uint8Array(await result);
}
async function read(start: number, end: number, expected = epoch): Promise<Uint8Array> {
  if (!source) throw new Error('Open a source first.');
  if (expected !== epoch) throw new Error('Source changed.');
  const bytes = await readRef(source, start, end);
  if (expected !== epoch) throw new Error('Source changed.');
  return bytes;
}
async function samples(start: number, end: number, expected = epoch): Promise<Float64Array> {
  if (!info) throw new Error('No source.');
  start = Math.max(0, Math.floor(start));
  end = Math.min(info.frames, Math.ceil(end));
  if (end <= start) return new Float64Array();
  if ((end - start) * info.channels > 16_000_000)
    throw new Error('Render input exceeds the working-memory budget.');
  const pcm = new Float64Array((end - start) * info.channels);
  const chunk = Math.floor((8 * 1024 * 1024) / info.blockAlign);
  for (let at = start; at < end; at += chunk) {
    const next = Math.min(end, at + chunk);
    const data = await read(
      info.dataOffset + at * info.blockAlign,
      info.dataOffset + next * info.blockAlign,
      expected,
    );
    pcm.set(decode(data, info), (at - start) * info.channels);
  }
  return pcm;
}
async function renderBlock(
  start: number,
  end: number,
  layers: Layer[],
  expected = epoch,
): Promise<Float64Array> {
  const i = info!;
  start = Math.max(0, Math.floor(start));
  end = Math.min(i.frames, Math.ceil(end));
  const active = layers.filter((l) => l.enabled && (l.processor || l.gainDb !== 0));
  if (!active.length) return samples(start, end, expected);
  const halo =
    2048 +
    active.reduce((sum, l) => sum + (l.processor?.kind === 'neuralSpeechV1' ? 120480 : 2048), 0);
  const a = Math.max(0, start - halo);
  const b = Math.min(i.frames, end + halo);
  if ((b - a) * i.channels > 16_000_000)
    throw new Error('This render block exceeds the working-memory budget.');
  const input = await samples(a, b, expected);
  const output = render(input, a, i, JSON.stringify(active));
  return output.slice((start - a) * i.channels, (end - a) * i.channels);
}
const tiles = new Map<number, Float64Array>();
let tileGraph = '',
  tileEpoch = -1;
async function processed(
  start: number,
  end: number,
  layers: Layer[],
  expected = epoch,
): Promise<Float64Array> {
  const graph = JSON.stringify(layers);
  if (graph !== tileGraph || tileEpoch !== expected) {
    tiles.clear();
    tileGraph = graph;
    tileEpoch = expected;
  }
  const i = info!;
  start = Math.max(0, Math.floor(start));
  end = Math.min(i.frames, Math.ceil(end));
  const out = new Float64Array((end - start) * i.channels);
  for (let t = Math.floor(start / 32768) * 32768; t < end; t += 32768) {
    let tile = tiles.get(t);
    if (!tile) {
      tile = await renderBlock(t, Math.min(i.frames, t + 32768), layers, expected);
      if (expected !== epoch) throw new Error('Source changed.');
      if (graph === tileGraph && expected === tileEpoch) {
        tiles.set(t, tile);
        if (tiles.size > 16) tiles.delete(tiles.keys().next().value!);
      }
    }
    const a = Math.max(start, t),
      b = Math.min(end, t + 32768);
    out.set(tile.subarray((a - t) * i.channels, (b - t) * i.channels), (a - start) * i.channels);
  }
  return out;
}
async function scanSource(expected: number) {
  const i = info!;
  const size = source!.kind === 'browser' ? source!.file.size : source!.size;
  const binFrames = Math.max(512, 2 ** Math.ceil(Math.log2(i.frames / 262144)));
  const chunkFrames = Math.max(binFrames, Math.floor(131072 / binFrames) * binFrames);
  const scan = new Scan(i.channels);
  try {
    scan.hash_bytes(await read(0, i.dataOffset, expected));
    for (let start = 0; start < i.frames; start += chunkFrames) {
      if (expected !== epoch) return;
      const end = Math.min(i.frames, start + chunkFrames);
      const bytes = await read(
        i.dataOffset + start * i.blockAlign,
        i.dataOffset + end * i.blockAlign,
        expected,
      );
      const pcm = decode(bytes, i);
      scan.hash_bytes(bytes);
      scan.push(pcm);
      const peaks = peak_bins(pcm, i.channels, binFrames);
      self.postMessage(
        {
          event: 'scan',
          epoch: expected,
          progress: end / i.frames,
          binStart: start / binFrames,
          binFrames,
          peaks,
          stats: scan.statistics(),
        },
        [peaks.buffer],
      );
      await delay();
    }
    if (i.dataOffset + i.dataBytes < size) {
      for (let p = i.dataOffset + i.dataBytes; p < size; p += 1024 * 1024) {
        if (expected !== epoch) return;
        scan.hash_bytes(await read(p, Math.min(size, p + 1024 * 1024), expected));
      }
    }
    if (expected === epoch)
      self.postMessage({ event: 'fingerprint', fingerprint: scan.fingerprint() });
  } catch (e) {
    if (expected === epoch) self.postMessage({ event: 'scanError', error: error(e) });
  } finally {
    scan.free();
  }
}
async function analyze(
  args: { view: { start: number; end: number }; fftSize: number; columns: number; layers: Layer[] },
  expected: number,
): Promise<Analysis | null> {
  const i = info!;
  const own = ++viewEpoch;
  const hop = Math.max(
    args.fftSize / 4,
    Math.ceil((args.view.end - args.view.start) / args.columns / (args.fftSize / 4)) *
      (args.fftSize / 4),
  );
  const first = Math.floor(args.view.start / hop) * hop;
  const columns = Math.ceil((args.view.end - first) / hop) + 1;
  const bins = args.fftSize / 2 + 1;
  const levels = new Float32Array(columns * bins * i.channels);
  const fft = new Spectrum(args.fftSize);
  try {
    for (let col = 0; col < columns; col++) {
      if (expected !== epoch || own !== viewEpoch) return null;
      const center = first + col * hop;
      const a = center - args.fftSize / 2;
      const b = a + args.fftSize;
      const start = Math.max(0, a);
      const end = Math.min(i.frames, b);
      const pcm =
        end > start ? await processed(start, end, args.layers, expected) : new Float64Array();
      if (expected !== epoch || own !== viewEpoch) return null;
      const window = new Float64Array(args.fftSize * i.channels);
      window.set(pcm, (start - a) * i.channels);
      for (let ch = 0; ch < i.channels; ch++)
        levels.set(fft.analyze(window, i.channels, ch), (ch * columns + col) * bins);
      if (col % 12 === 0) {
        self.postMessage({ event: 'analysisProgress', progress: col / columns });
        await delay();
      }
    }
    let waveform: Analysis['waveform'];
    if (args.view.end - args.view.start <= 262144) {
      const start = Math.max(0, Math.floor(args.view.start));
      const end = Math.min(i.frames, Math.ceil(args.view.end));
      const pcm = await samples(start, end, expected);
      const binFrames = Math.max(1, Math.ceil((end - start) / args.columns));
      waveform = { peaks: peak_bins(pcm, i.channels, binFrames), start, binFrames };
    }
    if (expected !== epoch || own !== viewEpoch) return null;
    return {
      levels,
      columns,
      bins,
      start: first,
      hop,
      fftSize: args.fftSize,
      channels: i.channels,
      sampleRate: i.sampleRate,
      waveform,
    };
  } finally {
    fft.free();
  }
}
async function playback(
  args: {
    position: number;
    count: number;
    deviceRate: number;
    layers: Layer[];
    mode: Monitor;
    end: number;
  },
  expected: number,
) {
  const i = info!;
  const count = Math.max(
    0,
    Math.min(args.count, Math.ceil(((args.end - args.position) * args.deviceRate) / i.sampleRate)),
  );
  if (count === 0) return { samples: new Float32Array(), frames: 0 };
  const start = Math.max(0, Math.floor(args.position) - 64);
  const end = Math.min(
    i.frames,
    Math.ceil(args.position + (count * i.sampleRate) / args.deviceRate) + 64,
  );
  let pcm = await (args.mode === 'original'
    ? samples(start, end, expected)
    : processed(start, end, args.layers, expected));
  if (args.mode === 'removed') {
    const raw = await samples(start, end, expected);
    for (let j = 0; j < pcm.length; j++) pcm[j] = raw[j] - pcm[j];
  }
  return {
    samples: resample(pcm, start, args.position, count, i.sampleRate, args.deviceRate, i.channels),
    frames: count,
  };
}
async function captureNoiseProfile(start: number, end: number): Promise<number[]> {
  const i = info!;
  const expected = epoch;
  start = Math.max(0, Math.ceil(start));
  end = Math.min(i.frames, Math.floor(end));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 2048)
    throw new Error('Select at least 2048 samples of noise only to capture a profile.');
  if (end - start > i.sampleRate * 10)
    throw new Error('Select at most 10 seconds of noise only to capture a profile.');
  const count = Math.min(512, Math.floor((end - start - 2048) / 512) + 1);
  const power = new Float64Array(1025 * i.channels);
  const fft = new Spectrum(2048);
  try {
    for (let frame = 0; frame < count; frame++) {
      const at = start + Math.floor((frame / Math.max(1, count - 1)) * (end - start - 2048));
      const pcm = await samples(at, at + 2048, expected);
      for (let ch = 0; ch < i.channels; ch++) {
        const levels = fft.analyze(pcm, i.channels, ch);
        for (let k = 0; k < 1025; k++) power[ch * 1025 + k] += 10 ** (levels[k] / 10);
      }
      if (frame % 16 === 0) await delay();
    }
    if (expected !== epoch) throw new Error('Source changed. Capture the noise profile again.');
    return Array.from(power, (p) =>
      Math.max(-240, Math.min(120, 10 * Math.log10(Math.max(1e-24, p / count)))),
    );
  } finally {
    fft.free();
  }
}
async function writeChunk(bytes: Uint8Array, requestId: number) {
  const id = ++ioId;
  const done = new Promise<void>((resolve, reject) => pendingWrites.set(id, { resolve, reject }));
  self.postMessage({ event: 'write', id, requestId, bytes }, [bytes.buffer]);
  await done;
}
async function exportAudio(
  args: { layers: Layer[]; bits: number; start: number; end: number; mode?: Monitor },
  requestId: number,
) {
  const i = info!;
  const expected = epoch,
    own = ++exportEpoch;
  const start = Math.max(0, Math.floor(args.start)),
    end = Math.min(i.frames, Math.floor(args.end));
  if (end <= start) throw new Error('Choose a nonempty export range.');
  if (args.mode && !['result', 'original', 'removed'].includes(args.mode))
    throw new Error('Invalid export signal.');
  await writeChunk(wav_header(i.sampleRate, i.channels, end - start, args.bits), requestId);
  let peak = 0;
  for (let p = start; p < end; p += 32768) {
    if (expected !== epoch || own !== exportEpoch) throw new Error('Export cancelled.');
    const next = Math.min(end, p + 32768);
    const pcm =
      args.mode === 'original'
        ? await samples(p, next, expected)
        : await processed(p, next, args.layers, expected);
    if (args.mode === 'removed') {
      const original = await samples(p, next, expected);
      for (let j = 0; j < pcm.length; j++) pcm[j] = original[j] - pcm[j];
    }
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    await writeChunk(encode(pcm, args.bits), requestId);
    self.postMessage({
      event: 'exportProgress',
      progress: (Math.min(end, p + 32768) - start) / (end - start),
    });
    await delay();
  }
  return { frames: end - start, peak };
}
self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.event === 'readResult') {
    const p = pendingReads.get(msg.id);
    pendingReads.delete(msg.id);
    if (msg.error) p?.reject(new Error(msg.error));
    else p?.resolve(msg.bytes);
    return;
  }
  if (msg.event === 'writeResult') {
    const p = pendingWrites.get(msg.id);
    pendingWrites.delete(msg.id);
    if (msg.error) p?.reject(new Error(msg.error));
    else p?.resolve();
    return;
  }
  if (msg.method === 'cancelExport') {
    exportEpoch++;
    return;
  }
  if (msg.method === 'cancelAnalysis') {
    viewEpoch++;
    return;
  }
  try {
    await ready;
    let value: unknown;
    switch (msg.method) {
      case 'open': {
        const own = ++openEpoch;
        const candidate = msg.args.source as SourceRef;
        const size = candidate.kind === 'browser' ? candidate.file.size : candidate.size;
        const metadata = inspect(
          await readRef(candidate, 0, Math.min(size, 4 * 1024 * 1024)),
          size,
        ) as WavInfo;
        if (own !== openEpoch) throw new Error('A newer source was opened.');
        source = candidate;
        info = metadata;
        epoch++;
        viewEpoch++;
        const expected = epoch;
        value = info;
        setTimeout(() => void scanSource(expected), 0);
        break;
      }
      case 'validate':
        validate(info, JSON.stringify(msg.args.layers));
        value = true;
        break;
      case 'noiseProfile':
        value = await captureNoiseProfile(msg.args.start, msg.args.end);
        break;
      case 'analyze':
        value = await analyze(msg.args, epoch);
        break;
      case 'playback':
        value = await playback(msg.args, epoch);
        break;
      case 'export':
        value = await exportAudio(msg.args, msg.id);
        break;
      default:
        throw new Error('Unknown audio engine request.');
    }
    const transfers: Transferable[] = [];
    if (value && typeof value === 'object') {
      if ('levels' in value) {
        transfers.push((value as Analysis).levels.buffer);
        const wave = (value as Analysis).waveform;
        if (wave) transfers.push(wave.peaks.buffer);
      }
      if ('samples' in value) transfers.push((value as { samples: Float32Array }).samples.buffer);
    }
    self.postMessage({ id: msg.id, value }, transfers);
  } catch (e) {
    self.postMessage({ id: msg.id, error: error(e) });
  }
};
