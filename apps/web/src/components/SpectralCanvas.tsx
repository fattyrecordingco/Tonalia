import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  AudioLines,
  FolderOpen,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Scan,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { WavInfo, View, Mask, Layer, Tool, Point, Analysis } from '../types';
import { formatHz, formatTime, maskBounds } from '../types';
import { clampView, zoomTime, zoomFrequency, panFrequency } from '../engine/navigation';
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
  hardness: number;
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
  const [hover, setHover] = useState<{ p: Point; ch: number } | null>(null);
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
  const viewRef = useRef(p.view);
  const pinchView = useRef<View | null>(null);
  viewRef.current = p.view;
  const fitView = (v: View) => clampView(v, p.info?.frames || 1);
  const updateView = (v: View) => {
    viewRef.current = v;
    p.onView(v);
  };
  const zoomHz = (factor: number) => {
    if (p.info) updateView(zoomFrequency(viewRef.current, p.info.sampleRate / 2, factor, 0.5));
  };
  const panHz = (fraction: number) => {
    if (p.info) updateView(panFrequency(viewRef.current, p.info.sampleRate / 2, fraction));
  };
  const zoom = (factor: number) =>
    updateView(zoomTime(viewRef.current, p.info?.frames || 1, factor));
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!p.info) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit,
        dy = e.deltaY * unit;
      const fraction = Math.max(0, Math.min(1, (e.clientX - r.left - LEFT) / width));
      const axis =
        e.clientY - r.top >= spectralTop &&
        (e.clientX - r.left < LEFT || e.clientX - r.left > size.w - RIGHT);
      if ((e.altKey && e.shiftKey) || (axis && !e.altKey)) {
        updateView(panFrequency(v, p.info.sampleRate / 2, -dy / laneHeight));
      } else if (e.altKey) {
        const y = e.clientY - r.top - spectralTop;
        const f = Math.max(
          0,
          Math.min(1, 1 - (((y % laneHeight) + laneHeight) % laneHeight) / laneHeight),
        );
        updateView(
          zoomFrequency(
            v,
            p.info.sampleRate / 2,
            Math.exp(Math.max(-2, Math.min(2, dy * 0.003))),
            f,
          ),
        );
      } else if (e.shiftKey || (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey && !e.metaKey)) {
        const delta = ((dx || dy) / width) * (v.end - v.start);
        updateView(clampView({ ...v, start: v.start + delta, end: v.end + delta }, p.info.frames));
      } else {
        updateView(
          zoomTime(
            v,
            p.info.frames,
            Math.exp(Math.max(-2, Math.min(2, dy * (e.ctrlKey ? 0.01 : 0.003)))),
            fraction,
          ),
        );
      }
    };
    // Safari sends gesture events for trackpad pinch instead of Ctrl-wheel.
    const gestureStart = (event: Event) => {
      event.preventDefault();
      pinchView.current = viewRef.current;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const e = event as Event & { scale: number; clientX: number };
      if (!pinchView.current || !p.info || !Number.isFinite(e.scale) || e.scale <= 0) return;
      const fraction = (e.clientX - el.getBoundingClientRect().left - LEFT) / width;
      updateView(zoomTime(pinchView.current, p.info.frames, 1 / e.scale, fraction));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gestureStart, { passive: false });
    el.addEventListener('gesturechange', gestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
    };
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
    if (
      kind === 'brush' &&
      (v.y < spectralTop || v.y >= spectralTop + laneHeight * p.info.channels)
    )
      return;
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
      const { radiusTime, radiusHz } = brushRadii(v.p.hz);
      const mask: Mask = {
        shape: {
          kind: 'brush',
          points: [v.p],
          radiusTime,
          radiusHz,
          opacity: p.opacity,
          hardness: p.hardness,
        },
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
    if (gesture.current && gesture.current.kind !== 'hand') {
      v.p.hz = hzAt(v.y, gesture.current.channel);
      v.ch = gesture.current.channel;
    }
    setHover(
      v.x >= LEFT &&
        v.x <= size.w - RIGHT &&
        v.y >= spectralTop &&
        v.y < spectralTop + laneHeight * p.info.channels
        ? { p: v.p, ch: v.ch }
        : null,
    );
    p.onCursor(v.p);
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(v.x - g.x, v.y - g.y) > 3) g.moved = true;
    if (g.kind === 'hand') {
      const delta = (-(v.x - g.x) / width) * (g.view.end - g.view.start);
      updateView(
        panFrequency(
          fitView({ ...g.view, start: g.view.start + delta, end: g.view.end + delta }),
          p.info.sampleRate / 2,
          (v.y - g.y) / laneHeight,
        ),
      );
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
      if (distance < 0.12) return;
      // Continuous DSP segments do not need synthetic dabs. Simplify old points
      // when the geometry budget fills, always retaining the newest endpoint.
      const points = s.points.length >= 4096 ? s.points.filter((_, i) => i % 2 === 0) : s.points;
      shape = { ...s, points: [...points, v.p] };
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
  const brushRadii = (hz: number) => ({
    radiusTime: Math.max(
      1,
      Math.min(
        (p.info?.sampleRate || 48000) * 10,
        (p.brushSize / 2 / width) * (p.view.end - p.view.start),
      ),
    ),
    radiusHz: Math.max(
      0.01,
      Math.min(
        (p.info?.sampleRate || 48000) / 2,
        p.view.log
          ? hz * Math.sinh((p.brushSize / 2 / laneHeight) * Math.log(p.view.high / p.view.low))
          : (p.brushSize / 2 / laneHeight) * (p.view.high - p.view.low),
      ),
    ),
  });
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
  const frequencyFloor = p.view.log ? 20 : 0;
  const transformHz = (hz: number) => (p.view.log ? Math.log(Math.max(20, hz)) : hz);
  const fullFrequencySpan =
    transformHz((p.info?.sampleRate || 48000) / 2) - transformHz(frequencyFloor);
  const visibleFrequencySpan = transformHz(p.view.high) - transformHz(p.view.low);
  const frequencyPanRoom = Math.max(0, fullFrequencySpan - visibleFrequencySpan);
  const frequencyPosition =
    frequencyPanRoom > 1e-9
      ? Math.max(
          0,
          Math.min(1, (transformHz(p.view.low) - transformHz(frequencyFloor)) / frequencyPanRoom),
        )
      : 0;
  const freqTicks = useMemo(() => {
    if (p.view.log && p.view.high / p.view.low > 4)
      return [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].filter(
        (f) => f >= p.view.low && f <= p.view.high,
      );
    const step = niceStep((p.view.high - p.view.low) / 6);
    const ticks = [];
    for (let f = Math.ceil(p.view.low / step) * step; f <= p.view.high; f += step) ticks.push(f);
    return ticks;
  }, [p.view.low, p.view.high, p.view.log]);
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
    if (s.hardness !== undefined) {
      // Render continuous capsules in the same sample/Hz space as the DSP,
      // then project onto the selected frequency scale. One filled path keeps
      // self-overlaps from visually accumulating opacity.
      const outline = (radius: number) => {
        const paths: string[] = [];
        const xy = (sample: number, hz: number) => `${tx(sample)},${fy(hz, ch)}`;
        for (let i = 0; i < s.points.length; i++) {
          const a = s.points[i];
          const circle = Array.from({ length: 16 }, (_, j) => {
            const angle = (-j / 16) * Math.PI * 2;
            return `${j ? 'L' : 'M'}${xy(a.sample + Math.cos(angle) * s.radiusTime * radius, a.hz + Math.sin(angle) * s.radiusHz * radius)}`;
          });
          paths.push(circle.join(' ') + 'Z');
          const b = s.points[i + 1];
          if (!b) continue;
          const dx = (b.sample - a.sample) / s.radiusTime;
          const dy = (b.hz - a.hz) / s.radiusHz;
          const length = Math.hypot(dx, dy);
          if (length < 1e-12) continue;
          const nx = (-dy / length) * s.radiusTime * radius;
          const ny = (dx / length) * s.radiusHz * radius;
          paths.push(
            `M${xy(a.sample + nx, a.hz + ny)}L${xy(b.sample + nx, b.hz + ny)}L${xy(b.sample - nx, b.hz - ny)}L${xy(a.sample - nx, a.hz - ny)}Z`,
          );
        }
        return paths.join(' ');
      };
      return (
        <g key={key} fill={color}>
          <path d={outline(1)} fillOpacity={selected ? s.opacity * 0.2 : 0.04} />
          {s.hardness > 0 && (
            <path d={outline(s.hardness)} fillOpacity={selected ? s.opacity * 0.15 : 0.02} />
          )}
        </g>
      );
    }
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
              ? `${useGpu ? 'GPU · ' : 'CPU · '}${(p.analysis.hop / (p.info?.sampleRate || 1)) * 1000 >= 100 ? 'Sampled overview · ' : ''}${p.analysis.fftSize} FFT · ${(p.analysis.sampleRate / p.analysis.fftSize).toFixed(1)} Hz/bin · Hann`
              : 'No source'}
        </span>
        <div className="canvas-zoom">
          <span className="zoom-axis">Time</span>
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
          <span className="zoom-axis">Hz</span>
          <button
            title="Zoom out vertically (Alt + wheel)"
            aria-label="Zoom out frequency"
            onClick={() => zoomHz(2)}
            disabled={!p.info}
          >
            <ZoomOut size={15} />
          </button>
          <button
            title="Zoom in vertically (Alt + wheel)"
            aria-label="Zoom in frequency"
            onClick={() => zoomHz(0.5)}
            disabled={!p.info}
          >
            <ZoomIn size={15} />
          </button>
          <button
            title="Pan to higher frequencies"
            aria-label="Pan frequency up"
            onClick={() => panHz(0.2)}
            disabled={!p.info}
          >
            <ArrowUp size={14} />
          </button>
          <button
            title="Pan to lower frequencies"
            aria-label="Pan frequency down"
            onClick={() => panHz(-0.2)}
            disabled={!p.info}
          >
            <ArrowDown size={14} />
          </button>
          <button
            title="Fit frequency range"
            aria-label="Fit frequency range"
            disabled={!p.info}
            onClick={() => {
              if (p.info)
                updateView({
                  ...viewRef.current,
                  low: p.view.log ? 20 : 0,
                  high: p.info.sampleRate / 2,
                });
            }}
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
          setHover(null);
        }}
        onPointerLeave={() => {
          setHover(null);
          if (!gesture.current) p.onCursor(null);
        }}
      >
        {p.info && (
          <input
            className="frequency-scrollbar"
            aria-label="Frequency scroll"
            title="Drag to scroll frequency. Scroll over the Hz ruler to pan vertically; Alt + scroll to zoom."
            type="range"
            min="0"
            max="1"
            step="0.001"
            value={frequencyPosition}
            disabled={frequencyPanRoom < 1e-9}
            style={{ top: spectralTop, right: 1, height: laneHeight * p.info.channels }}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (p.info && visibleFrequencySpan > 0)
                updateView(
                  panFrequency(
                    viewRef.current,
                    p.info.sampleRate / 2,
                    ((+e.target.value - frequencyPosition) * frequencyPanRoom) /
                      visibleFrequencySpan,
                  ),
                );
            }}
          />
        )}
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
                  {p.tool === 'brush' &&
                    hover?.ch === ch &&
                    (() => {
                      const s = gesture.current?.mask?.shape;
                      const radii = s?.kind === 'brush' ? s : brushRadii(hover.p.hz);
                      return (
                        <g className="brush-preview" data-testid="brush-preview">
                          {[1, p.hardness]
                            .filter((r) => r > 0)
                            .map((r) => (
                              <ellipse
                                key={r}
                                cx={tx(hover.p.sample)}
                                cy={
                                  (fy(hover.p.hz + radii.radiusHz * r, ch) +
                                    fy(hover.p.hz - radii.radiusHz * r, ch)) /
                                  2
                                }
                                rx={Math.max(
                                  1,
                                  tx(hover.p.sample + radii.radiusTime * r) - tx(hover.p.sample),
                                )}
                                ry={Math.max(
                                  1,
                                  (fy(hover.p.hz - radii.radiusHz * r, ch) -
                                    fy(hover.p.hz + radii.radiusHz * r, ch)) /
                                    2,
                                )}
                                fill="none"
                                stroke={r === 1 ? '#e9fff6' : '#b0efdc'}
                                strokeWidth={1}
                                strokeDasharray={r === 1 ? undefined : '2 3'}
                              />
                            ))}
                          <path
                            d={`M${tx(hover.p.sample) - 3},${fy(hover.p.hz, ch)}h6M${tx(hover.p.sample)},${fy(hover.p.hz, ch) - 3}v6`}
                            stroke="#e9fff6"
                          />
                        </g>
                      );
                    })()}
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
              Drop a WAV recording here to explore its spectrum
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
          <span className="shortcut-hint">
            Scroll / pinch to zoom · Shift + scroll to pan · Scroll Hz ruler to pan vertically · Alt
            to zoom Hz
          </span>
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
