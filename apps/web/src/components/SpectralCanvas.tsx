import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AudioLines, FolderOpen, MousePointer2, ZoomIn, ZoomOut, Scan } from 'lucide-react';
import type { WavInfo, View, Mask, Layer, Tool, Point, Analysis } from '../types';
import { formatHz, formatTime, maskBounds } from '../types';
import { GpuSpectrogram } from '../engine/gpu-spectrogram';
export interface Overview {
  peaks: Float32Array;
  binFrames: number;
  scannedFrames: number;
}
interface Props {
  info: WavInfo | null;
  view: View;
  analysis: Analysis | null;
  overview: Overview | null;
  selection: Mask | null;
  layers: Layer[];
  tool: Tool;
  position: number;
  floor: number;
  ceiling: number;
  pending: boolean;
  brushSize: number;
  opacity: number;
  channel: number | null;
  onSelection: (s: Mask | null) => void;
  onView: (v: View) => void;
  onSeek: (s: number) => void;
  onCursor: (p: Point | null) => void;
  onOpen: () => void;
  onDemo: () => void;
  onFit: () => void;
  onZoomSelection: () => void;
}
const LEFT = 52,
  RIGHT = 16,
  TOP = 26,
  WAVE = 74,
  GAP = 24;
const palette = Array.from({ length: 256 }, (_, i) => {
  const stops = [
    [8, 13, 24],
    [27, 31, 65],
    [60, 44, 99],
    [114, 60, 114],
    [178, 91, 102],
    [225, 140, 101],
    [249, 209, 139],
    [255, 248, 218],
  ];
  const x = (i / 255) * (stops.length - 1),
    j = Math.min(stops.length - 2, Math.floor(x)),
    t = x - j;
  return stops[j].map((v, c) => Math.round(v + (stops[j + 1][c] - v) * t));
});
function niceStep(value: number) {
  const base = 10 ** Math.floor(Math.log10(value));
  const n = value / base;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * base;
}
export function SpectralCanvas(p: Props) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    wave = useRef<HTMLCanvasElement>(null),
    overviewCanvas = useRef<HTMLCanvasElement>(null);
  const gpuCanvas = useRef<HTMLCanvasElement>(null),
    gpu = useRef<GpuSpectrogram | null>(null);
  const [useGpu, setUseGpu] = useState(false);
  const [size, setSize] = useState({ w: 1000, h: 550 });
  const [drawing, setDrawing] = useState(false);
  const gesture = useRef<{
    origin: Point;
    points: Point[];
    mask: Mask | null;
    view: View;
    x: number;
    y: number;
    kind: Tool;
    channel: number;
    moved: boolean;
  } | null>(null);
  const width = Math.max(1, size.w - LEFT - RIGHT),
    spectralTop = TOP + WAVE + GAP;
  const laneHeight = Math.max(1, (size.h - spectralTop - 28) / (p.info?.channels || 1));
  const tx = useCallback(
    (s: number) => LEFT + ((s - p.view.start) / (p.view.end - p.view.start)) * width,
    [p.view, width],
  );
  const fy = useCallback(
    (hz: number, ch = 0) => {
      const hi = p.view.high,
        lo = p.view.low;
      const fraction = p.view.log
        ? Math.log(Math.max(lo, hz) / lo) / Math.log(hi / lo)
        : (hz - lo) / (hi - lo);
      return spectralTop + ch * laneHeight + (1 - fraction) * laneHeight;
    },
    [p.view, spectralTop, laneHeight],
  );
  const hzAt = (y: number, ch: number) => {
    const fraction = Math.max(0, Math.min(1, 1 - (y - spectralTop - ch * laneHeight) / laneHeight));
    return p.view.log
      ? p.view.low * (p.view.high / p.view.low) ** fraction
      : p.view.low + fraction * (p.view.high - p.view.low);
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try {
      if (gpuCanvas.current) {
        gpu.current = new GpuSpectrogram(gpuCanvas.current, () => setUseGpu(false));
        setUseGpu(true);
      }
    } catch {
      setUseGpu(false);
    }
    return () => gpu.current?.dispose();
  }, []);
  useEffect(() => {
    if (useGpu && p.analysis && gpu.current) {
      try {
        gpu.current.draw(
          p.analysis,
          p.view,
          width,
          laneHeight * (p.info?.channels || 1),
          p.floor,
          p.ceiling,
        );
      } catch {
        setUseGpu(false);
      }
    }
  }, [useGpu, p.analysis, p.view, p.floor, p.ceiling, p.info, width, laneHeight]);
  // Repaint spectral pixels only when audio analysis, view, or display settings change.
  useEffect(() => {
    const c = canvas.current;
    if (!c || useGpu) return;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) return;
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(laneHeight * (p.info?.channels || 1)));
    ctx.fillStyle = '#090d17';
    ctx.fillRect(0, 0, c.width, c.height);
    const a = p.analysis;
    if (!a || !p.info) return;
    const image = ctx.createImageData(c.width, c.height);
    const pixels = image.data;
    const range = p.ceiling - p.floor;
    const binRows = Array.from({ length: c.height }, (_, y) => {
      const ch = Math.min(a.channels - 1, Math.floor(y / laneHeight));
      const frac = 1 - (y - ch * laneHeight) / laneHeight;
      const f = p.view.log
        ? p.view.low * (p.view.high / p.view.low) ** frac
        : p.view.low + (p.view.high - p.view.low) * frac;
      return {
        ch,
        bin: Math.max(0, Math.min(a.bins - 1, Math.round((f * a.fftSize) / a.sampleRate))),
      };
    });
    for (let x = 0; x < c.width; x++) {
      const t = p.view.start + (x / c.width) * (p.view.end - p.view.start);
      const col = Math.round((t - a.start) / a.hop);
      for (let y = 0; y < c.height; y++) {
        const { ch, bin } = binRows[y];
        const value =
          col >= 0 && col < a.columns ? a.levels[(ch * a.columns + col) * a.bins + bin] : -240;
        const color =
          palette[Math.max(0, Math.min(255, Math.round(((value - p.floor) / range) * 255)))];
        const at = (y * c.width + x) * 4;
        pixels[at] = color[0];
        pixels[at + 1] = color[1];
        pixels[at + 2] = color[2];
        pixels[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [useGpu, p.analysis, p.view, p.floor, p.ceiling, p.info, width, laneHeight]);
  useEffect(() => {
    const c = wave.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = WAVE * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, WAVE);
    if (!p.info || !p.overview) return;
    const detail = p.analysis?.waveform;
    const useDetail =
      detail &&
      detail.start <= p.view.start &&
      detail.start + (detail.peaks.length / (p.info.channels * 2)) * detail.binFrames >= p.view.end;
    const o = useDetail ? detail! : p.overview;
    const origin = useDetail ? detail!.start : 0;
    const channels = p.info.channels,
      lh = WAVE / channels;
    for (let ch = 0; ch < channels; ch++) {
      ctx.strokeStyle = ch === 0 ? '#a5bdc5' : '#7f9cab';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const from = Math.floor(
          (p.view.start + (x / width) * (p.view.end - p.view.start) - origin) / o.binFrames,
        );
        const to = Math.max(
          from,
          Math.ceil(
            (p.view.start + ((x + 1) / width) * (p.view.end - p.view.start) - origin) / o.binFrames,
          ) - 1,
        );
        let lo = 0,
          hi = 0;
        for (let b = from; b <= to; b++) {
          lo = Math.min(lo, o.peaks[b * channels * 2 + ch * 2] || 0);
          hi = Math.max(hi, o.peaks[b * channels * 2 + ch * 2 + 1] || 0);
        }
        const center = ch * lh + lh / 2;
        ctx.moveTo(x, center - Math.min(1, hi) * lh * 0.43);
        ctx.lineTo(x, center - Math.max(-1, lo) * lh * 0.43);
      }
      ctx.stroke();
      ctx.strokeStyle = '#45505e55';
      ctx.beginPath();
      ctx.moveTo(0, ch * lh + lh / 2);
      ctx.lineTo(width, ch * lh + lh / 2);
      ctx.stroke();
    }
  }, [p.overview, p.analysis, p.view, p.info, width]);
  useEffect(() => {
    const c = overviewCanvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, size.w * dpr);
    c.height = 42 * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, 42);
    if (!p.overview || !p.info) return;
    const o = p.overview;
    ctx.strokeStyle = '#71838e';
    ctx.beginPath();
    for (let x = 0; x < size.w; x++) {
      let lo = 0,
        hi = 0;
      const from = Math.floor(((x / size.w) * p.info.frames) / o.binFrames),
        to = Math.ceil((((x + 1) / size.w) * p.info.frames) / o.binFrames);
      for (let b = from; b < to; b++)
        for (let ch = 0; ch < p.info.channels; ch++) {
          lo = Math.min(lo, o.peaks[b * p.info.channels * 2 + ch * 2] || 0);
          hi = Math.max(hi, o.peaks[b * p.info.channels * 2 + ch * 2 + 1] || 0);
        }
      ctx.moveTo(x, 21 - hi * 18);
      ctx.lineTo(x, 21 - lo * 18);
    }
    ctx.stroke();
  }, [p.overview, p.info, size.w]);
  const fitView = (v: View): View => {
    const frames = p.info?.frames || 1;
    const span = Math.min(frames, Math.max(64, v.end - v.start));
    const start = Math.max(0, Math.min(frames - span, v.start));
    return { ...v, start, end: start + span };
  };
  const zoom = (factor: number, anchor = (p.view.start + p.view.end) / 2) => {
    const before = (anchor - p.view.start) / (p.view.end - p.view.start);
    const span = (p.view.end - p.view.start) * factor;
    p.onView(
      fitView({ ...p.view, start: anchor - span * before, end: anchor + span * (1 - before) }),
    );
  };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!p.info) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.altKey) {
        const center = (p.view.high + p.view.low) / 2;
        const factor = Math.exp(e.deltaY * 0.002);
        const span = (p.view.high - p.view.low) * factor;
        const low = Math.max(p.view.log ? 20 : 0, center - span / 2),
          high = Math.min(p.info.sampleRate / 2, center + span / 2);
        if (high - low > 100) p.onView({ ...p.view, low, high });
      } else if (e.ctrlKey || e.metaKey) {
        const at =
          p.view.start + ((e.clientX - r.left - LEFT) / width) * (p.view.end - p.view.start);
        zoom(Math.exp(e.deltaY * 0.004), at);
      } else {
        const delta = ((e.deltaX || e.deltaY) / width) * (p.view.end - p.view.start);
        p.onView(fitView({ ...p.view, start: p.view.start + delta, end: p.view.end + delta }));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });
  const point = (e: ReactPointerEvent) => {
    const r = root.current!.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    const ch = Math.max(
      0,
      Math.min((p.info?.channels || 1) - 1, Math.floor((y - spectralTop) / laneHeight)),
    );
    return {
      x,
      y,
      ch,
      p: {
        sample: Math.round(
          Math.max(
            0,
            Math.min(
              p.info?.frames || 0,
              p.view.start + ((x - LEFT) / width) * (p.view.end - p.view.start),
            ),
          ),
        ),
        hz: hzAt(y, ch),
      },
    };
  };
  const down = (e: ReactPointerEvent) => {
    if (!p.info || e.button > 1) return;
    const v = point(e);
    if (v.x < LEFT || v.x > size.w - RIGHT) return;
    root.current?.focus({ preventScroll: true });
    const kind = e.button === 1 || p.tool === 'hand' ? 'hand' : p.tool;
    const channel = p.channel;
    gesture.current = {
      origin: v.p,
      points: [v.p],
      mask: null,
      view: p.view,
      x: v.x,
      y: v.y,
      kind,
      channel: v.ch,
      moved: false,
    };
    if (kind === 'brush') {
      const radiusTime = Math.max(1, (p.brushSize / 2 / width) * (p.view.end - p.view.start));
      const radiusHz = Math.max(
        0.01,
        (hzAt(v.y - p.brushSize / 2, v.ch) - hzAt(v.y + p.brushSize / 2, v.ch)) / 2,
      );
      const mask: Mask = {
        shape: { kind: 'brush', points: [v.p], radiusTime, radiusHz, opacity: p.opacity },
        channel,
        featherTime: 0,
        featherHz: 0,
      };
      gesture.current.mask = mask;
      p.onSelection(mask);
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrawing(true);
    e.preventDefault();
  };
  const move = (e: ReactPointerEvent) => {
    if (!p.info) return;
    const v = point(e);
    p.onCursor(v.p);
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(v.x - g.x, v.y - g.y) > 3) g.moved = true;
    if (g.kind === 'hand') {
      const delta = (-(v.x - g.x) / width) * (g.view.end - g.view.start);
      p.onView(fitView({ ...g.view, start: g.view.start + delta, end: g.view.end + delta }));
      return;
    }
    let shape: Mask['shape'];
    if (g.kind === 'brush' && g.mask?.shape.kind === 'brush') {
      const s = g.mask.shape;
      const last = s.points[s.points.length - 1];
      const distance = Math.hypot(
        (v.p.sample - last.sample) / s.radiusTime,
        (v.p.hz - last.hz) / s.radiusHz,
      );
      if (distance < 0.3) return;
      const steps = Math.min(32, Math.ceil(distance / 0.35));
      const add = Array.from({ length: steps }, (_, i) => ({
        sample: Math.round(last.sample + ((v.p.sample - last.sample) * (i + 1)) / steps),
        hz: last.hz + ((v.p.hz - last.hz) * (i + 1)) / steps,
      }));
      shape = { ...s, points: [...s.points, ...add].slice(0, 1024) };
    } else if (g.kind === 'lasso') {
      const last = g.points[g.points.length - 1];
      if (Math.abs(tx(last.sample) - v.x) + Math.abs(fy(last.hz, g.channel) - v.y) < 3) return;
      g.points = [...g.points, v.p].slice(0, 1024);
      shape = { kind: 'polygon', points: g.points };
    } else {
      const full = g.kind === 'time' || g.y < spectralTop;
      shape = {
        kind: 'rectangle',
        start: Math.min(g.origin.sample, v.p.sample),
        end: Math.max(g.origin.sample, v.p.sample),
        low: full ? 0 : Math.min(g.origin.hz, v.p.hz),
        high: full ? p.info.sampleRate / 2 : Math.max(g.origin.hz, v.p.hz),
      };
    }
    const mask: Mask = {
      shape,
      channel: p.channel,
      featherTime: shape.kind === 'brush' ? 0 : p.info.sampleRate * 0.005,
      featherHz: shape.kind === 'brush' ? 0 : p.info.sampleRate / 2048,
    };
    g.mask = mask;
    p.onSelection(mask);
  };
  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    setDrawing(false);
    if (!g) return;
    if (!g.moved && g.kind !== 'brush') {
      p.onSeek(g.origin.sample);
      return;
    }
    if (g.kind === 'lasso' && g.points.length < 3) p.onSelection(null);
  };
  const ticks = useMemo(() => {
    const span = (p.view.end - p.view.start) / (p.info?.sampleRate || 48000);
    const step = niceStep(span / 8);
    const first = Math.ceil(p.view.start / (p.info?.sampleRate || 48000) / step) * step;
    const out = [];
    for (let t = first; t < p.view.end / (p.info?.sampleRate || 48000) + step / 100; t += step)
      out.push(t);
    return out;
  }, [p.view, p.info]);
  const freqTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
    (f) => f >= p.view.low && f <= p.view.high,
  );
  const maskPath = (m: Mask, ch: number, key: string, selected: boolean) => {
    if (m.channel !== null && m.channel !== ch) return null;
    const s = m.shape;
    const color = selected ? '#b0efdc' : '#aec4e9';
    const common = {
      stroke: color,
      fill: color,
      fillOpacity: selected ? 0.12 : 0.035,
      strokeOpacity: selected ? 0.95 : 0.36,
      strokeWidth: selected ? 1.2 : 0.8,
    };
    if (s.kind === 'rectangle') {
      const x = tx(s.start),
        y = fy(s.high, ch);
      return (
        <rect
          key={key}
          x={x}
          y={y}
          width={Math.max(0.1, tx(s.end) - x)}
          height={Math.max(0.1, fy(s.low, ch) - y)}
          {...common}
        />
      );
    }
    if (s.kind === 'polygon')
      return (
        <path
          key={key}
          d={
            s.points.map((v, i) => `${i ? 'L' : 'M'}${tx(v.sample)},${fy(v.hz, ch)}`).join(' ') +
            ' Z'
          }
          {...common}
        />
      );
    return (
      <g key={key}>
        {s.points
          .filter((_, i) => i % Math.max(1, Math.floor(s.points.length / 150)) === 0)
          .map((v, i) => (
            <ellipse
              key={i}
              cx={tx(v.sample)}
              cy={(fy(v.hz + s.radiusHz, ch) + fy(v.hz - s.radiusHz, ch)) / 2}
              rx={Math.max(1, tx(v.sample + s.radiusTime) - tx(v.sample))}
              ry={Math.max(1, (fy(v.hz - s.radiusHz, ch) - fy(v.hz + s.radiusHz, ch)) / 2)}
              stroke={color}
              strokeOpacity={selected ? 0.25 : 0.08}
              fill={color}
              fillOpacity={selected ? s.opacity * 0.05 : 0.02}
            />
          ))}
      </g>
    );
  };
  return (
    <div className="canvas-column">
      <div
        className="overview"
        aria-label="Source overview"
        onPointerDown={(e) => {
          if (!p.info) return;
          const r = e.currentTarget.getBoundingClientRect();
          const mid = ((e.clientX - r.left) / r.width) * p.info.frames;
          const span = p.view.end - p.view.start;
          p.onView(fitView({ ...p.view, start: mid - span / 2, end: mid + span / 2 }));
        }}
      >
        <canvas ref={overviewCanvas} />
        {p.info && (
          <div
            className="overview-window"
            style={{
              left: `${(p.view.start / p.info.frames) * 100}%`,
              width: `${((p.view.end - p.view.start) / p.info.frames) * 100}%`,
            }}
          />
        )}
        <span>Source overview</span>
      </div>
      <div className="canvas-info">
        <span>
          <span className="signal-dot" />
          {p.layers.some((l) => l.enabled) ? 'Processed spectrum' : 'Source spectrum'}
        </span>
        <span>
          {p.view.log ? 'Logarithmic' : 'Linear'} frequency{' '}
          <span className="subtle-divider">/</span>{' '}
          {p.pending
            ? 'Analyzing…'
            : p.analysis
              ? `${useGpu ? 'GPU · ' : 'CPU · '}${(p.analysis.hop / (p.info?.sampleRate || 1)) * 1000 >= 100 ? 'Sampled overview · ' : ''}${p.analysis.fftSize} FFT · Hann`
              : 'No source'}
        </span>
        <div className="canvas-zoom">
          <button title="Zoom out" aria-label="Zoom out" onClick={() => zoom(2)} disabled={!p.info}>
            <ZoomOut size={15} />
          </button>
          <button title="Zoom in" aria-label="Zoom in" onClick={() => zoom(0.5)} disabled={!p.info}>
            <ZoomIn size={15} />
          </button>
          <button
            title="Fit source (Shift+1)"
            aria-label="Fit source"
            onClick={p.onFit}
            disabled={!p.info}
          >
            <Scan size={15} />
          </button>
        </div>
      </div>
      <div
        className={`spectral-viewport tool-${p.tool} ${drawing ? 'drawing' : ''}`}
        ref={root}
        tabIndex={0}
        aria-label="Spectral audio canvas. Use the tools or numeric selection inspector to select frequencies."
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            gesture.current = null;
            setDrawing(false);
            p.onSelection(null);
          }
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          gesture.current = null;
          setDrawing(false);
        }}
        onPointerLeave={() => {
          if (!gesture.current) p.onCursor(null);
        }}
      >
        <canvas
          ref={wave}
          className="source-waveform"
          style={{ left: LEFT, top: TOP, width, height: WAVE }}
        />
        <canvas
          ref={gpuCanvas}
          className="spectral-pixels gpu-spectral"
          style={{
            display: useGpu && p.analysis ? 'block' : 'none',
            left: LEFT,
            top: spectralTop,
            width,
            height: laneHeight * (p.info?.channels || 1),
            opacity: p.pending && p.analysis ? 0.5 : 1,
          }}
        />
        <canvas
          ref={canvas}
          className="spectral-pixels"
          style={{
            display: useGpu ? 'none' : 'block',
            left: LEFT,
            top: spectralTop,
            width,
            height: laneHeight * (p.info?.channels || 1),
            opacity: p.pending && p.analysis ? 0.5 : 1,
          }}
        />
        {p.info && (
          <svg className="canvas-overlay" width={size.w} height={size.h} aria-hidden="true">
            <defs>
              {Array.from({ length: p.info.channels }, (_, ch) => (
                <clipPath key={ch} id={`lane-${ch}`}>
                  <rect
                    x={LEFT}
                    y={spectralTop + ch * laneHeight}
                    width={width}
                    height={laneHeight}
                  />
                </clipPath>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <text
                  x={tx(t * p.info!.sampleRate)}
                  y={16}
                  textAnchor="middle"
                  className="ruler-text"
                >
                  {formatTime(t, t < 1 ? 3 : 1)}
                </text>
                <line
                  x1={tx(t * p.info!.sampleRate)}
                  x2={tx(t * p.info!.sampleRate)}
                  y1={TOP}
                  y2={size.h - 28}
                  className="time-grid"
                />
              </g>
            ))}
            {Array.from({ length: p.info.channels }, (_, ch) => (
              <g key={ch}>
                <text
                  x={14}
                  y={TOP + ch * (WAVE / p.info!.channels) + WAVE / p.info!.channels / 2 + 4}
                  className="channel-label"
                >
                  {p.info!.channels === 1 ? 'M' : ch === 0 ? 'L' : 'R'}
                </text>
                <text
                  x={LEFT + 8}
                  y={spectralTop + ch * laneHeight + 17}
                  className="spectral-channel"
                >
                  {p.info!.channels === 1 ? 'Mono' : ch === 0 ? 'Left' : 'Right'}
                </text>
                {freqTicks.map((f) => (
                  <g key={f}>
                    <text x={LEFT - 9} y={fy(f, ch) + 4} textAnchor="end" className="ruler-text">
                      {formatHz(f)}
                    </text>
                    <line
                      x1={LEFT}
                      x2={size.w - RIGHT}
                      y1={fy(f, ch)}
                      y2={fy(f, ch)}
                      className="frequency-grid"
                    />
                  </g>
                ))}
                <g clipPath={`url(#lane-${ch})`}>
                  {p.layers.filter((l) => l.enabled).map((l) => maskPath(l.mask, ch, l.id, false))}
                  {p.selection && maskPath(p.selection, ch, 'selection', true)}
                </g>
                <line
                  x1={LEFT}
                  x2={size.w - RIGHT}
                  y1={spectralTop + (ch + 1) * laneHeight}
                  y2={spectralTop + (ch + 1) * laneHeight}
                  className="lane-divider"
                />
              </g>
            ))}
            {p.position >= p.view.start && p.position <= p.view.end && (
              <g>
                <line
                  x1={tx(p.position)}
                  x2={tx(p.position)}
                  y1={23}
                  y2={size.h - 28}
                  stroke="#e6eee9"
                  strokeWidth={1}
                />
                <path d={`M${tx(p.position) - 4} 22h8l-4 6Z`} fill="#e6eee9" />
              </g>
            )}
            {p.selection && (
              <text
                x={Math.max(
                  LEFT + 8,
                  Math.min(size.w - 180, tx(maskBounds(p.selection).start) + 6),
                )}
                y={size.h - 8}
                className="selection-caption"
              >
                {formatTime(
                  (maskBounds(p.selection).end - maskBounds(p.selection).start) / p.info.sampleRate,
                )}{' '}
                selected
              </text>
            )}
            <text x={size.w - RIGHT} y={size.h - 8} textAnchor="end" className="ruler-text">
              Hz
            </text>
          </svg>
        )}
        {!p.info && (
          <div className="canvas-empty">
            <div className="empty-wave">
              <AudioLines size={52} strokeWidth={1} />
            </div>
            <h1>
              Every frequency.
              <br />
              Within reach.
            </h1>
            <p>
              Open a WAV recording to explore its spectrum
              <br />
              and make your first reversible edit.
            </p>
            <button className="primary-button" onClick={p.onOpen}>
              <FolderOpen size={16} /> Open audio
            </button>
            <button className="text-button" onClick={p.onDemo}>
              Explore a calibration session
            </button>
            <span className="empty-footnote">Local processing. Your source stays untouched.</span>
          </div>
        )}
        {p.info && !p.analysis && p.pending && (
          <div className="analysis-loading">
            <span className="spinner" /> Computing spectral analysis
          </div>
        )}
      </div>
      <div className="canvas-bottom">
        <span>
          <MousePointer2 size={12} />{' '}
          {p.tool === 'hand'
            ? 'Drag to pan'
            : p.tool === 'brush'
              ? 'Paint a weighted selection'
              : p.tool === 'lasso'
                ? 'Draw around frequencies'
                : 'Drag to select'}
          <span className="shortcut-hint">Ctrl + scroll to zoom</span>
        </span>
        <div className="db-key">
          <span>{p.floor} dB</span>
          <div />
          <span>{p.ceiling} dBFS</span>
        </div>
      </div>
    </div>
  );
}
