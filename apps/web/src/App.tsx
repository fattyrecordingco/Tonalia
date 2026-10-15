import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  AudioLines,
  Brush,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileAudio,
  FolderOpen,
  Hand,
  Headphones,
  Layers,
  Lasso,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat2,
  Save,
  Settings2,
  SkipBack,
  SlidersHorizontal,
  Square,
  SquareDashed,
  Trash2,
  Undo2,
  Volume2,
  X,
} from 'lucide-react';
import { AudioEngine, calibrationFile } from './engine/client';
import { SpectralCanvas, type Overview } from './components/SpectralCanvas';
import { NumberField } from './components/NumberField';
import { SpectrumPlot } from './components/SpectrumPlot';
import type {
  WavInfo,
  View,
  Mask,
  Layer,
  Point,
  Analysis,
  Tool,
  Monitor,
  SourceRef,
  Statistics,
  Project,
} from './types';
import { formatTime, formatHz, formatDb, maskBounds, isNative } from './types';

const INITIAL_VIEW: View = { start: 0, end: 48000 * 18, low: 20, high: 24000, log: true };
const tools: { id: Tool; label: string; key: string; icon: typeof Brush }[] = [
  { id: 'time', label: 'Time selection', key: 'T', icon: MousePointer2 },
  { id: 'rectangle', label: 'Frequency rectangle', key: 'M', icon: SquareDashed },
  { id: 'lasso', label: 'Lasso selection', key: 'L', icon: Lasso },
  { id: 'brush', label: 'Spectral brush', key: 'B', icon: Brush },
  { id: 'hand', label: 'Pan canvas', key: 'H', icon: Hand },
];
function sourceName(source: SourceRef) {
  return source.kind === 'browser' ? source.file.name : source.name;
}
function readProject(text: string): Project {
  if (text.length > 4 * 1024 * 1024)
    throw new Error('The project exceeds the 4 MiB manifest limit.');
  const p = JSON.parse(text) as Project;
  if (
    p.format !== 'tonalia' ||
    p.schema !== 1 ||
    p.engine !== 'spectral-gain-v1' ||
    p.fftSize !== 2048
  )
    throw new Error('This project version is not supported. No edits were loaded.');
  if (
    !p.source ||
    !Array.isArray(p.layers) ||
    p.layers.length > 64 ||
    !p.view ||
    !/^[a-f0-9]{64}$/.test(p.source.sha256) ||
    typeof p.source.name !== 'string' ||
    typeof p.view.log !== 'boolean'
  )
    throw new Error('The project manifest is invalid.');
  if (
    ![
      p.source.frames,
      p.source.sampleRate,
      p.source.channels,
      p.source.size,
      p.view.start,
      p.view.end,
      p.view.low,
      p.view.high,
    ].every(Number.isFinite) ||
    p.view.start < 0 ||
    p.view.end > p.source.frames ||
    p.view.start >= p.view.end ||
    p.view.low < 0 ||
    p.view.high > p.source.sampleRate / 2 ||
    p.view.low >= p.view.high ||
    (p.view.log && p.view.low === 0)
  )
    throw new Error('The project contains invalid coordinates.');
  return p;
}
export default function App() {
  const [engine] = useState(() => new AudioEngine());
  const [info, setInfo] = useState<WavInfo | null>(null),
    [name, setName] = useState('Untitled session');
  const infoRef = useRef<WavInfo | null>(null),
    nameRef = useRef(''),
    sourceSize = useRef(0);
  const [view, setView] = useState<View>(INITIAL_VIEW),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [overview, setOverview] = useState<Overview | null>(null);
  const [selection, setSelection] = useState<Mask | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ past: Layer[][]; present: Layer[]; future: Layer[][] }>({
    past: [],
    present: [],
    future: [],
  });
  const layers = history.present;
  const [tool, setTool] = useState<Tool>('rectangle'),
    [channel, setChannel] = useState<number | null>(null),
    [brushSize, setBrushSize] = useState(34),
    [opacity, setOpacity] = useState(0.7);
  const [gain, setGain] = useState(-18),
    [layerName, setLayerName] = useState('Spectral attenuation');
  const [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [preparing, setPreparing] = useState(false),
    [loop, setLoop] = useState(false),
    [mode, setMode] = useState<Monitor>('result'),
    [volume, setVolume] = useState(-6);
  const positionRef = useRef(0),
    playEpoch = useRef(0);
  const [fftSize, setFftSize] = useState(2048),
    [floor, setFloor] = useState(-110),
    [ceiling, setCeiling] = useState(-10),
    [pending, setPending] = useState(false),
    [analysisProgress, setAnalysisProgress] = useState(0);
  const [scanProgress, setScanProgress] = useState(0),
    [fingerprint, setFingerprint] = useState(''),
    [stats, setStats] = useState<Statistics | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null),
    [tab, setTab] = useState<'edit' | 'analyze'>('edit');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(false),
    [dirty, setDirty] = useState(false),
    [dragging, setDragging] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0),
    [exportBits, setExportBits] = useState(32),
    [exportRange, setExportRange] = useState<'all' | 'selection'>('all');
  const [projectMenu, setProjectMenu] = useState(false),
    [pendingProject, setPendingProject] = useState<Project | null>(null);
  const expectedProject = useRef<Project | null>(null);
  const [device, setDevice] = useState<{
    name: string;
    sampleRate: number;
    backend: string;
    channels: number;
  } | null>(null);
  const audioInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    dialogRef = useRef<HTMLDialogElement>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
  }, []);
  const stop = useCallback(async () => {
    playEpoch.current++;
    setPreparing(false);
    setPlaying(false);
    await engine.stop();
  }, [engine]);
  const applyProject = useCallback(
    async (project: Project) => {
      await engine.call('validate', { layers: project.layers });
      setHistory({ past: [], present: project.layers, future: [] });
      setView(project.view);
      setSelection(null);
      setSelectedId(null);
      setDirty(false);
      setPendingProject(null);
      expectedProject.current = null;
      notify('Project restored. Original source verified by SHA-256.');
    },
    [engine, notify],
  );
  useEffect(() => {
    engine.onScan = (e) => {
      const current = infoRef.current;
      if (!current) return;
      setScanProgress(e.progress);
      setStats(e.stats);
      setOverview((previous) => {
        const bins = Math.ceil(current.frames / e.binFrames);
        const peaks =
          previous?.binFrames === e.binFrames
            ? previous.peaks
            : new Float32Array(bins * current.channels * 2);
        peaks.set(e.peaks, e.binStart * current.channels * 2);
        return { peaks, binFrames: e.binFrames, scannedFrames: e.stats.frames };
      });
    };
    engine.onFingerprint = (hash) => {
      setFingerprint(hash);
      const project = expectedProject.current;
      if (!project) return;
      const current = infoRef.current;
      if (
        hash !== project.source.sha256 ||
        current?.frames !== project.source.frames ||
        current?.sampleRate !== project.source.sampleRate ||
        current?.channels !== project.source.channels
      ) {
        setError(
          'This WAV does not match the project’s original source. Select the original WAV to relink safely.',
        );
        return;
      }
      void applyProject(project).catch((e) => setError(String(e)));
    };
    engine.onPosition = (at, active) => {
      positionRef.current = at;
      setPosition(at);
      setPlaying(active);
    };
    engine.onAnalysisProgress = setAnalysisProgress;
    engine.onExportProgress = setExportProgress;
    engine.onError = (e) => {
      setError(e);
      setPlaying(false);
      setPreparing(false);
    };
    engine.onDevice = setDevice;
    void engine.init().catch((e) => setError(String(e)));
    return () => engine.dispose();
  }, [engine, applyProject]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const handle = (e: BeforeUnloadEvent) => {
      if (dirty || exporting) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handle);
    return () => window.removeEventListener('beforeunload', handle);
  }, [dirty, exporting]);
  useEffect(() => {
    if (!info) return;
    let active = true;
    setPending(true);
    setAnalysisProgress(0);
    engine.cancelAnalysis();
    const timer = setTimeout(() => {
      void engine
        .analyze(view, fftSize, layers)
        .then((result) => {
          if (active && result) {
            setAnalysis(result);
            setPending(false);
          }
        })
        .catch((e) => {
          if (active) {
            setPending(false);
            setError(String(e));
          }
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
      engine.cancelAnalysis();
    };
  }, [engine, info, view, fftSize, layers]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (exportOpen && !dialog?.open) dialog?.showModal();
    else if (!exportOpen && dialog?.open) dialog.close();
  }, [exportOpen]);
  const commit = useCallback(
    (next: Layer[], message?: string) => {
      void stop();
      setHistory((h) => ({ past: [...h.past.slice(-99), h.present], present: next, future: [] }));
      setDirty(true);
      if (message) notify(message);
    },
    [stop, notify],
  );
  const undo = useCallback(() => {
    if (!history.past.length) return;
    void stop();
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      present: h.past[h.past.length - 1],
      future: [h.present, ...h.future],
    }));
    setSelection(null);
    setSelectedId(null);
    setDirty(true);
  }, [history.past.length, stop]);
  const redo = useCallback(() => {
    if (!history.future.length) return;
    void stop();
    setHistory((h) => ({
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    }));
    setSelection(null);
    setSelectedId(null);
    setDirty(true);
  }, [history.future.length, stop]);
  const openSource = useCallback(
    async (source: SourceRef) => {
      if (exporting) {
        setError('Finish or cancel the export before opening another source.');
        await engine.discardCandidate(source);
        return;
      }
      if (
        dirty &&
        !expectedProject.current &&
        !window.confirm('Open another source and discard unsaved layer edits?')
      ) {
        await engine.discardCandidate(source);
        return;
      }
      setLoading(true);
      setError('');
      await stop();
      try {
        const metadata = await engine.load(source);
        infoRef.current = metadata;
        nameRef.current = sourceName(source);
        sourceSize.current = source.kind === 'browser' ? source.file.size : source.size;
        setInfo(metadata);
        setName(nameRef.current);
        setView({
          start: 0,
          end: metadata.frames,
          low: 20,
          high: metadata.sampleRate / 2,
          log: true,
        });
        setOverview(null);
        setAnalysis(null);
        setStats(null);
        setFingerprint('');
        setScanProgress(0);
        setPosition(0);
        positionRef.current = 0;
        setSelection(null);
        setSelectedId(null);
        setHistory({ past: [], present: [], future: [] });
        setChannel(null);
        setDirty(false);
        setDevice(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [engine, stop, dirty, exporting],
  );
  const launchRequested = useRef(false);
  useEffect(() => {
    if (!isNative() || launchRequested.current) return;
    launchRequested.current = true;
    void invoke<SourceRef | null>('take_launch_source')
      .then((source) => {
        if (source) return openSource(source);
      })
      .catch((e) => setError(String(e)));
  }, [openSource]);
  const chooseAudio = useCallback(async () => {
    setProjectMenu(false);
    if (isNative()) {
      try {
        const source = await engine.chooseNativeSource();
        if (source) await openSource(source);
      } catch (e) {
        setError(String(e));
      }
    } else audioInput.current?.click();
  }, [engine, openSource]);
  const loadCalibration = useCallback(() => {
    void openSource({ kind: 'browser', file: calibrationFile() });
  }, [openSource]);
  const setRegion = useCallback((mask: Mask | null) => {
    setSelection(mask);
    setSelectedId(null);
  }, []);
  const seek = useCallback(
    (at: number) => {
      void stop();
      positionRef.current = at;
      setPosition(at);
    },
    [stop],
  );
  const fit = useCallback(() => {
    if (info) setView((v) => ({ ...v, start: 0, end: info.frames }));
  }, [info]);
  const fitSelection = useCallback(() => {
    if (!selection || !info) return;
    const b = maskBounds(selection);
    const margin = Math.max(256, (b.end - b.start) * 0.08);
    setView((v) => ({
      ...v,
      start: Math.max(0, b.start - margin),
      end: Math.min(info.frames, b.end + margin),
    }));
  }, [selection, info]);
  const applyGain = useCallback(async () => {
    if (!selection || !info) return;
    try {
      const layer: Layer = {
        id: selectedId || crypto.randomUUID(),
        name: layerName.trim() || 'Spectral gain',
        enabled: true,
        gainDb: gain,
        mask: structuredClone(selection),
      };
      const next = selectedId
        ? layers.map((l) => (l.id === selectedId ? layer : l))
        : [...layers, layer];
      await engine.call('validate', { layers: next });
      commit(
        next,
        selectedId ? 'Layer updated. Source unchanged.' : 'Reversible spectral layer created.',
      );
      setSelectedId(layer.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selection, info, selectedId, layerName, gain, layers, engine, commit]);
  const play = useCallback(async () => {
    if (playing || preparing) {
      await stop();
      return;
    }
    if (!info) return;
    const span = selection ? maskBounds(selection) : null;
    const end = loop && span ? Math.min(info.frames, span.end) : info.frames;
    let at = positionRef.current;
    if (at >= end - 1) at = loop && span ? Math.max(0, span.start) : 0;
    if (loop && span && (at < span.start || at >= span.end)) at = Math.max(0, span.start);
    const own = ++playEpoch.current;
    setPreparing(true);
    setError('');
    try {
      await engine.play(Math.floor(at), Math.floor(end), layers, mode, 10 ** (volume / 20), loop);
      if (own === playEpoch.current) {
        setPlaying(true);
        setPreparing(false);
      }
    } catch (e) {
      if (own === playEpoch.current) {
        setPreparing(false);
        setPlaying(false);
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [playing, preparing, stop, info, selection, loop, layers, mode, volume, engine]);
  const saveProject = useCallback(async () => {
    if (!info || !fingerprint) {
      notify('Wait for the source scan and fingerprint before saving.');
      return;
    }
    const project: Project = {
      format: 'tonalia',
      schema: 1,
      engine: 'spectral-gain-v1',
      fftSize: 2048,
      source: {
        name: nameRef.current,
        size: sourceSize.current,
        sha256: fingerprint,
        sampleRate: info.sampleRate,
        channels: info.channels,
        frames: info.frames,
      },
      layers,
      view,
    };
    try {
      if (await engine.saveProject(project)) {
        setDirty(false);
        notify('Project saved. Keep the original WAV for reopening.');
      }
    } catch (e) {
      setError(String(e));
    }
  }, [info, fingerprint, layers, view, engine, notify]);
  const loadProject = useCallback(
    async (text: string) => {
      try {
        const project = readProject(text);
        if (dirty && !window.confirm('Load this project and discard unsaved layer edits?')) return;
        await stop();
        setProjectMenu(false);
        setError('');
        if (fingerprint === project.source.sha256 && info?.frames === project.source.frames) {
          await applyProject(project);
        } else {
          expectedProject.current = project;
          setPendingProject(project);
          notify('Select the original WAV to verify and restore this project.');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [dirty, stop, fingerprint, info, applyProject, notify],
  );
  const chooseProject = async () => {
    if (isNative()) {
      try {
        const text = await engine.chooseProject();
        if (text) await loadProject(text);
      } catch (e) {
        setError(String(e));
      }
    } else projectInput.current?.click();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable="true"],dialog')
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveProject();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void applyGain();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        void play();
        return;
      }
      if (e.key === 'Escape') {
        setRegion(null);
        setProjectMenu(false);
        return;
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault();
        fit();
        return;
      }
      if (e.shiftKey && e.code === 'Digit2') {
        e.preventDefault();
        fitSelection();
        return;
      }
      const t = tools.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey) setTool(t.id);
      if (e.key === '[') setBrushSize((v) => Math.max(8, v - 4));
      if (e.key === ']') setBrushSize((v) => Math.min(120, v + 4));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [redo, undo, saveProject, applyGain, play, setRegion, fit, fitSelection]);
  const bounds = selection
    ? maskBounds(selection)
    : {
        start: Math.min(position, Math.max(0, (info?.frames || 48000) - 1)),
        end: Math.min(info?.frames || 48000, position + (info?.sampleRate || 48000)),
        low: 20,
        high: info ? info.sampleRate / 2 : 24000,
      };
  const editBounds = (field: 'start' | 'end' | 'low' | 'high', value: number) => {
    if (!info) return;
    const next = { ...bounds, [field]: value };
    next.start = Math.max(0, Math.min(info.frames - 1, Math.round(next.start)));
    next.end = Math.max(next.start + 1, Math.min(info.frames, Math.round(next.end)));
    next.low = Math.max(0, Math.min(info.sampleRate / 2 - 0.01, next.low));
    next.high = Math.max(next.low + 0.01, Math.min(info.sampleRate / 2, next.high));
    setSelection({
      shape: { kind: 'rectangle', ...next },
      channel,
      featherTime: selection?.featherTime ?? info.sampleRate * 0.005,
      featherHz: selection?.featherHz ?? info.sampleRate / 2048,
    });
  };
  const exportAudio = async () => {
    if (!info) return;
    setExportError('');
    setExporting(true);
    setExportProgress(0);
    setError('');
    await stop();
    const a = exportRange === 'selection' ? Math.max(0, Math.floor(bounds.start)) : 0,
      b = exportRange === 'selection' ? Math.min(info.frames, Math.ceil(bounds.end)) : info.frames;
    try {
      const result = await engine.export(name, layers, a, b, exportBits);
      if (result) {
        setExportOpen(false);
        notify(
          `Exported ${formatTime(result.frames / info.sampleRate)} at ${info.sampleRate} Hz. Peak ${formatDb(result.peak)}.`,
        );
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };
  const selectLayer = (l: Layer) => {
    setSelectedId(l.id);
    setSelection(structuredClone(l.mask));
    setLayerName(l.name);
    setGain(l.gainDb);
    setChannel(l.mask.channel);
    setTab('edit');
  };
  const reorder = (index: number, direction: number) => {
    const next = [...layers];
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    commit(next);
  };
  const wholePeak = stats ? Math.max(...stats.channels.map((c) => c.peak)) : 0;
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
          if (file.name.endsWith('.json')) void file.text().then(loadProject);
          else void openSource({ kind: 'browser', file });
        }
      }}
    >
      <input
        ref={audioInput}
        type="file"
        accept=".wav,.wave,audio/wav"
        hidden
        aria-label="Import WAV"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openSource({ kind: 'browser', file: f });
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        hidden
        aria-label="Import project"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && f.size <= 4 * 1024 * 1024) void f.text().then(loadProject);
          else if (f) setError('The project exceeds the 4 MiB manifest limit.');
        }}
      />
      <header className="app-header">
        <div className="brand">
          <svg width="29" height="29" viewBox="0 0 40 40" aria-hidden="true">
            <path
              d="M3 24C9 24 9 9 15 9S21 32 27 32 32 15 38 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M3 29C9 29 10 14 15 14S22 24 27 24 32 8 38 8"
              fill="none"
              stroke="currentColor"
              opacity=".4"
              strokeWidth="1.3"
            />
          </svg>
          <strong>tonalia</strong>
          <span className="brand-divider" />
          <span className="studio-name">Fatty Recording Co</span>
        </div>
        <div className="project-title">
          <span>{info ? name.replace(/\.(wav|wave)$/i, '') : 'Untitled session'}</span>
          <span className={`save-state ${dirty ? 'unsaved' : ''}`}>
            {dirty
              ? 'Unsaved edits'
              : info
                ? fingerprint
                  ? 'Source verified'
                  : 'Scanning source'
                : 'Local workspace'}
          </span>
        </div>
        <div className="header-actions">
          <div className="project-dropdown">
            <button
              className="quiet-button"
              onClick={() => setProjectMenu((v) => !v)}
              aria-expanded={projectMenu}
            >
              Project <ChevronDown size={13} />
            </button>
            {projectMenu && (
              <div className="dropdown-menu">
                <button
                  onClick={() => {
                    void saveProject();
                    setProjectMenu(false);
                  }}
                  disabled={!info || !fingerprint}
                >
                  <Save size={15} />
                  Save project<span>Ctrl S</span>
                </button>
                <button onClick={() => void chooseProject()}>
                  <FolderOpen size={15} />
                  Open project
                </button>
                <button
                  onClick={() => {
                    setProjectMenu(false);
                    loadCalibration();
                  }}
                >
                  <Activity size={15} />
                  Calibration session
                </button>
              </div>
            )}
          </div>
          <button
            className="quiet-button"
            onClick={() => void chooseAudio()}
            disabled={loading || exporting}
          >
            <FolderOpen size={15} />
            Open WAV
          </button>
          <button
            className="export-button"
            onClick={() => {
              setExportError('');
              setExportOpen(true);
            }}
            disabled={!info || loading || !!pendingProject}
          >
            <Download size={15} />
            Export audio
          </button>
        </div>
      </header>
      <div className="tool-strip">
        <div className="tool-palette" role="toolbar" aria-label="Selection tools">
          {tools.map((t) => (
            <button
              key={t.id}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              className={tool === t.id ? 'active' : ''}
              onClick={() => setTool(t.id)}
            >
              <t.icon size={18} />
            </button>
          ))}
        </div>
        <span className="tool-name">{tools.find((t) => t.id === tool)?.label}</span>
        {tool === 'brush' && (
          <>
            <label className="inline-control">
              Size
              <input
                aria-label="Brush diameter"
                type="range"
                min="8"
                max="120"
                value={brushSize}
                onChange={(e) => setBrushSize(+e.target.value)}
              />
              <span>{brushSize}px</span>
            </label>
            <label className="inline-control">
              Opacity
              <input
                aria-label="Brush opacity"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(+e.target.value)}
              />
              <span>{Math.round(opacity * 100)}%</span>
            </label>
          </>
        )}
        <div className="strip-spacer" />
        <div className="cursor-readout">
          {cursor && info ? (
            <>
              {formatTime(cursor.sample / info.sampleRate)}
              <span>/</span>
              {Math.round(cursor.hz).toLocaleString()} Hz
            </>
          ) : (
            <span>Time × frequency</span>
          )}
        </div>
        <div className="undo-group">
          <button
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            onClick={undo}
            disabled={!history.past.length}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            onClick={redo}
            disabled={!history.future.length}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>
      {pendingProject && (
        <div className="relink-banner">
          <FileAudio size={16} />
          <span>
            Relink <strong>{pendingProject.source.name}</strong>. Edits load only after the source
            fingerprint matches.
          </span>
          <button onClick={() => void chooseAudio()}>Choose original WAV</button>
          <button
            aria-label="Cancel project relink"
            onClick={() => {
              setPendingProject(null);
              expectedProject.current = null;
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className="left-panel" aria-label="Source and spectral layers">
          <div className="panel-heading">
            <h2>Session</h2>
            <span className="session-badge">Local</span>
          </div>
          <div className="source-card">
            <div className="source-icon">
              <FileAudio size={20} />
            </div>
            <div>
              <strong title={name}>{info ? name : 'No audio loaded'}</strong>
              <span>
                {info
                  ? `${(info.sampleRate / 1000).toLocaleString()} kHz · ${info.bitsPerSample}-bit ${info.float ? 'float' : 'PCM'} · ${info.channels === 1 ? 'Mono' : 'Stereo'}`
                  : 'WAV · PCM & IEEE float'}
              </span>
            </div>
            {info && <Check size={13} className="source-check" />}
          </div>
          <div className="layer-heading">
            <span>
              <Layers size={15} /> Spectral layers
            </span>
            <span>{layers.length}</span>
          </div>
          <div className="layers-list">
            {layers.length === 0 ? (
              <div className="layers-empty">
                <div className="layer-empty-lines">
                  <span />
                  <span />
                  <span />
                </div>
                <p>Your edits live here.</p>
                <span>
                  Select frequencies, then create
                  <br />a gain layer in the inspector.
                </span>
              </div>
            ) : (
              [...layers].reverse().map((l) => {
                const index = layers.findIndex((x) => x.id === l.id);
                return (
                  <div
                    className={`layer-item ${selectedId === l.id ? 'selected' : ''} ${!l.enabled ? 'bypassed' : ''}`}
                    key={l.id}
                  >
                    <button
                      className="layer-enable"
                      aria-label={`${l.enabled ? 'Bypass' : 'Enable'} ${l.name}`}
                      title={l.enabled ? 'Bypass audio processing' : 'Enable audio processing'}
                      onClick={() =>
                        commit(
                          layers.map((x) => (x.id === l.id ? { ...x, enabled: !x.enabled } : x)),
                        )
                      }
                    >
                      {l.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button className="layer-main" onClick={() => selectLayer(l)}>
                      <span>{l.name}</span>
                      <small>
                        {l.gainDb > 0 ? '+' : ''}
                        {l.gainDb.toFixed(1)} dB{' '}
                        <span>
                          · {l.mask.shape.kind} ·{' '}
                          {l.mask.channel === null ? 'Linked' : l.mask.channel === 0 ? 'L' : 'R'}
                        </span>
                      </small>
                    </button>
                    <div className="layer-actions">
                      <button
                        aria-label={`Move ${l.name} later`}
                        disabled={index === layers.length - 1}
                        onClick={() => reorder(index, 1)}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        aria-label={`Move ${l.name} earlier`}
                        disabled={index === 0}
                        onClick={() => reorder(index, -1)}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        aria-label={`Delete ${l.name}`}
                        onClick={() => {
                          commit(layers.filter((x) => x.id !== l.id));
                          if (selectedId === l.id) {
                            setSelectedId(null);
                            setSelection(null);
                          }
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="source-layer">
            <span className="source-layer-dot" />
            <div>
              <strong>Original source</strong>
              <span>Read only · always preserved</span>
            </div>
            <FileAudio size={14} />
          </div>
          <div className="left-bottom">
            <div className="section-heading">
              <h3>Source statistics</h3>
              <Activity size={14} />
            </div>
            <dl className="mini-stats">
              <div>
                <dt>Duration</dt>
                <dd>{info ? formatTime(info.frames / info.sampleRate) : '—'}</dd>
              </div>
              <div>
                <dt>Sample peak</dt>
                <dd className={wholePeak >= 1 ? 'over-level' : ''}>
                  {stats ? formatDb(wholePeak) : '—'}
                </dd>
              </div>
              <div>
                <dt>RMS</dt>
                <dd>
                  {stats
                    ? formatDb(
                        Math.sqrt(
                          stats.channels.reduce((s, c) => s + c.rms * c.rms, 0) /
                            stats.channels.length,
                        ),
                      )
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Correlation</dt>
                <dd>{stats?.correlation != null ? stats.correlation.toFixed(3) : 'Undefined'}</dd>
              </div>
            </dl>
            {info && (
              <div className="scan-state">
                <span className={fingerprint ? 'verified-dot' : 'scanning-dot'} />
                {fingerprint
                  ? 'SHA-256 verified'
                  : `Scanning source ${Math.round(scanProgress * 100)}%`}
              </div>
            )}
            <p className="caption">
              {info ? 'Measured on original audio.' : 'Audio is processed on your device.'}
            </p>
          </div>
        </aside>
        <section className="editor-panel" aria-label="Audio workspace">
          <div className="document-tab">
            <span>
              <AudioLines size={15} />
              {info ? name : 'Spectral workspace'}
            </span>
            <span>
              {info ? `${info.frames.toLocaleString()} samples / channel` : 'Ready when you are'}
            </span>
          </div>
          <SpectralCanvas
            info={info}
            view={view}
            analysis={analysis}
            overview={overview}
            selection={selection}
            layers={layers}
            tool={tool}
            position={position}
            floor={floor}
            ceiling={ceiling}
            pending={pending}
            brushSize={brushSize}
            opacity={opacity}
            channel={channel}
            onSelection={setRegion}
            onView={setView}
            onSeek={seek}
            onCursor={setCursor}
            onOpen={() => void chooseAudio()}
            onDemo={loadCalibration}
            onFit={fit}
            onZoomSelection={fitSelection}
          />
        </section>
        <aside className="right-panel" aria-label="Inspector">
          <div className="inspector-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'edit'}
              className={tab === 'edit' ? 'active' : ''}
              onClick={() => setTab('edit')}
            >
              Edit
            </button>
            <button
              role="tab"
              aria-selected={tab === 'analyze'}
              className={tab === 'analyze' ? 'active' : ''}
              onClick={() => setTab('analyze')}
            >
              Analyze
            </button>
            <SlidersHorizontal size={15} />
          </div>
          <div className="inspector-content">
            {tab === 'edit' ? (
              <>
                <div className="section-heading">
                  <h3>{selectedId ? 'Edit layer' : 'Selection'}</h3>
                  {selection && (
                    <button
                      aria-label="Zoom to selection"
                      title="Zoom to selection (Shift+2)"
                      onClick={fitSelection}
                    >
                      <Maximize2 size={13} />
                    </button>
                  )}
                </div>
                <div className="selection-kind">
                  <span>
                    {selection
                      ? selection.shape.kind === 'rectangle'
                        ? 'Time–frequency range'
                        : selection.shape.kind === 'polygon'
                          ? 'Freeform lasso'
                          : 'Weighted brush'
                      : 'Make a selection on the canvas'}
                  </span>
                  {selection && (
                    <button className="text-button" onClick={() => setRegion(null)}>
                      Clear
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <NumberField
                    label="Start"
                    value={bounds.start / (info?.sampleRate || 48000)}
                    min={0}
                    max={(info?.frames || 48000) / (info?.sampleRate || 48000)}
                    unit="s"
                    onCommit={(v) => editBounds('start', v * (info?.sampleRate || 48000))}
                  />
                  <NumberField
                    label="End"
                    value={bounds.end / (info?.sampleRate || 48000)}
                    min={0}
                    max={(info?.frames || 48000) / (info?.sampleRate || 48000)}
                    unit="s"
                    onCommit={(v) => editBounds('end', v * (info?.sampleRate || 48000))}
                  />
                  <NumberField
                    label="Low frequency"
                    value={bounds.low}
                    min={0}
                    max={info ? info.sampleRate / 2 : 24000}
                    digits={1}
                    unit="Hz"
                    onCommit={(v) => editBounds('low', v)}
                  />
                  <NumberField
                    label="High frequency"
                    value={bounds.high}
                    min={0}
                    max={info ? info.sampleRate / 2 : 24000}
                    digits={1}
                    unit="Hz"
                    onCommit={(v) => editBounds('high', v)}
                  />
                </div>
                <label className="select-field">
                  <span>Channels</span>
                  <select
                    aria-label="Target channels"
                    value={channel ?? 'linked'}
                    onChange={(e) => {
                      const c = e.target.value === 'linked' ? null : +e.target.value;
                      setChannel(c);
                      setSelection((s) => (s ? { ...s, channel: c } : s));
                    }}
                  >
                    <option value="linked">
                      {info?.channels === 1 ? 'Mono' : 'Linked stereo'}
                    </option>
                    <option value="0">{info?.channels === 1 ? 'Mono' : 'Left only'}</option>
                    {info?.channels === 2 && <option value="1">Right only</option>}
                  </select>
                </label>
                <div className="inspector-section">
                  <div className="section-heading">
                    <h3>Spectral gain</h3>
                    <span className="unit-label">Nondestructive</span>
                  </div>
                  <label className="layer-name-field">
                    <span>Layer name</span>
                    <input
                      aria-label="Layer name"
                      value={layerName}
                      maxLength={120}
                      onChange={(e) => setLayerName(e.target.value)}
                    />
                  </label>
                  <div className="gain-display">
                    <span>
                      {gain > 0 ? '+' : ''}
                      {gain.toFixed(1)}
                      <small> dB</small>
                    </span>
                    <span>{gain <= 0 ? 'Attenuation' : 'Boost'}</span>
                  </div>
                  <input
                    className="gain-slider"
                    aria-label="Spectral gain"
                    type="range"
                    min="-120"
                    max="24"
                    step="0.5"
                    value={gain}
                    onChange={(e) => setGain(+e.target.value)}
                  />
                  <div className="slider-labels">
                    <span>−120</span>
                    <span>−60</span>
                    <span>0</span>
                    <span>+24</span>
                  </div>
                  <div className="gain-presets">
                    {[-6, -18, -36, -120].map((g) => (
                      <button
                        key={g}
                        className={gain === g ? 'active' : ''}
                        onClick={() => setGain(g)}
                      >
                        {g} dB
                      </button>
                    ))}
                  </div>
                  <div className="field-grid feather-fields">
                    <NumberField
                      disabled={selection?.shape.kind === 'brush'}
                      label="Time feather"
                      value={
                        ((selection?.featherTime ?? (info?.sampleRate || 48000) * 0.005) /
                          (info?.sampleRate || 48000)) *
                        1000
                      }
                      min={0}
                      max={1000}
                      digits={1}
                      unit="ms"
                      onCommit={(v) =>
                        setSelection((s) =>
                          s ? { ...s, featherTime: (v * (info?.sampleRate || 48000)) / 1000 } : s,
                        )
                      }
                    />
                    <NumberField
                      disabled={selection?.shape.kind === 'brush'}
                      label="Frequency feather"
                      value={selection?.featherHz ?? (info?.sampleRate || 48000) / 2048}
                      min={0}
                      max={info ? info.sampleRate / 2 : 24000}
                      digits={1}
                      unit="Hz"
                      onCommit={(v) => setSelection((s) => (s ? { ...s, featherHz: v } : s))}
                    />
                  </div>
                  <button
                    className="apply-button"
                    onClick={() => void applyGain()}
                    disabled={!info || !selection || !!pendingProject || exporting}
                  >
                    <Plus size={15} />
                    {selectedId ? 'Update layer' : 'Create gain layer'}
                  </button>
                  <p className="caption">
                    {selection
                      ? '2048-point FFT · 75% overlap. Feathering and window support extend beyond the drawn edge.'
                      : 'Select a region or enter bounds above. Your source audio is never overwritten.'}
                  </p>
                  {selectedId && (
                    <button
                      className="quiet-button full-width"
                      onClick={() => {
                        setSelectedId(null);
                        setLayerName('Spectral attenuation');
                        notify('The selection is ready for a new layer.');
                      }}
                    >
                      <Copy size={14} />
                      Use selection for a new layer
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <SpectrumPlot analysis={analysis} position={cursor?.sample ?? position} />
                <div className="inspector-section">
                  <div className="section-heading">
                    <h3>Source measurements</h3>
                    <span>
                      {stats ? `${Math.round(scanProgress * 100)}% scanned` : 'No source'}
                    </span>
                  </div>
                  {stats?.channels.map((c, i) => (
                    <div className="channel-stats" key={i}>
                      <h4>
                        {info?.channels === 1 ? 'Mono' : i === 0 ? 'Left channel' : 'Right channel'}
                      </h4>
                      <dl className="mini-stats">
                        <div>
                          <dt>Peak amplitude</dt>
                          <dd>{formatDb(c.peak)}</dd>
                        </div>
                        <div>
                          <dt>Peak position</dt>
                          <dd>{formatTime(c.peakFrame / (info?.sampleRate || 48000))}</dd>
                        </div>
                        <div>
                          <dt>RMS amplitude</dt>
                          <dd>{formatDb(c.rms)}</dd>
                        </div>
                        <div>
                          <dt>DC offset</dt>
                          <dd>{(c.dc * 100).toFixed(5)}%</dd>
                        </div>
                        <div>
                          <dt>At / above 0 dBFS</dt>
                          <dd>{c.fullScaleSamples.toLocaleString()}</dd>
                        </div>
                      </dl>
                    </div>
                  ))}
                  <p className="caption">
                    Sample peak and unweighted RMS. These are not true-peak or LUFS measurements.
                  </p>
                </div>
              </>
            )}
            <div className="inspector-section display-section">
              <div className="section-heading">
                <h3>Display</h3>
                <Settings2 size={14} />
              </div>
              <label className="select-field">
                <span>Analysis FFT</span>
                <select
                  aria-label="Analysis FFT size"
                  value={fftSize}
                  onChange={(e) => setFftSize(+e.target.value)}
                >
                  {[512, 1024, 2048, 4096, 8192].map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString()} samples
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>Frequency scale</span>
                <select
                  aria-label="Frequency scale"
                  value={view.log ? 'log' : 'linear'}
                  onChange={(e) =>
                    setView((v) => ({
                      ...v,
                      log: e.target.value === 'log',
                      low: e.target.value === 'log' ? Math.max(20, v.low) : 0,
                    }))
                  }
                >
                  <option value="log">Logarithmic</option>
                  <option value="linear">Linear</option>
                </select>
              </label>
              <div className="field-grid">
                <NumberField
                  label="Display floor"
                  value={floor}
                  min={-180}
                  max={ceiling - 10}
                  digits={0}
                  unit="dB"
                  onCommit={setFloor}
                />
                <NumberField
                  label="Display ceiling"
                  value={ceiling}
                  min={floor + 10}
                  max={12}
                  digits={0}
                  unit="dB"
                  onCommit={setCeiling}
                />
              </div>
              <p className="caption">Display settings change the view, never the sound.</p>
            </div>
          </div>
        </aside>
      </main>
      <footer className="transport">
        <div className="transport-controls">
          <button
            aria-label="Return to start"
            onClick={() => seek(loop && selection ? Math.max(0, bounds.start) : 0)}
            disabled={!info}
          >
            <SkipBack size={18} />
          </button>
          <button
            className={`play-button ${playing ? 'playing' : ''}`}
            aria-label={playing || preparing ? 'Pause playback' : 'Play audio'}
            onClick={() => void play()}
            disabled={!info || !!pendingProject}
          >
            {preparing ? (
              <LoaderCircle size={19} className="spinning" />
            ) : playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <button aria-label="Stop playback" onClick={() => void stop()} disabled={!info}>
            <Square size={15} />
          </button>
          <button
            className={loop ? 'active' : ''}
            aria-pressed={loop}
            aria-label="Loop playback"
            title="Loop selection time range, or whole source"
            onClick={() => {
              void stop();
              setLoop((v) => !v);
            }}
            disabled={!info}
          >
            <Repeat2 size={18} />
          </button>
        </div>
        <div className="time-display">
          <span>{formatTime(position / (info?.sampleRate || 48000))}</span>
          <small>/ {info ? formatTime(info.frames / info.sampleRate) : '0:00.000'}</small>
        </div>
        <div className="monitor-modes" aria-label="Monitor mode">
          {(['original', 'result', 'removed'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                void stop();
                setMode(m);
              }}
              title={m === 'removed' ? 'Original minus processed result' : 'Monitor ' + m}
            >
              {m === 'original' ? 'Original' : m === 'result' ? 'Result' : 'Removed'}
            </button>
          ))}
        </div>
        <div className="monitor-level">
          <Volume2 size={16} />
          <input
            aria-label="Monitor volume"
            type="range"
            min="-60"
            max="0"
            step="1"
            value={volume}
            onChange={(e) => {
              const v = +e.target.value;
              setVolume(v);
              engine.setVolume(10 ** (v / 20));
            }}
          />
          <span>{volume} dB</span>
          <Headphones size={15} />
        </div>
      </footer>
      <div className="status-bar">
        <span>
          <span className="engine-dot" />
          Rust audio core <span className="status-divider" />{' '}
          {isNative() ? 'Desktop' : 'WebAssembly'} <span className="status-divider" />{' '}
          {info ? `${info.sampleRate.toLocaleString()} Hz source` : 'No source loaded'}
        </span>
        <span>
          {loading
            ? 'Opening audio…'
            : pending
              ? `Analyzing ${Math.round(analysisProgress * 100)}%`
              : playing
                ? 'Playing'
                : info
                  ? 'Ready'
                  : 'Open a WAV to begin'}
          {device && (
            <>
              {' '}
              <span className="status-divider" /> {device.sampleRate.toLocaleString()} Hz output
            </>
          )}
        </span>
        <span>
          Tonalia 0.1 <span className="status-divider" /> Local development build
        </span>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <FileAudio size={36} />
          <h2>Drop a WAV or Tonalia project</h2>
          <span>Your audio stays on this device.</span>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="export-dialog"
        onCancel={(e) => {
          if (exporting) {
            e.preventDefault();
            engine.cancelExport();
          } else setExportOpen(false);
        }}
      >
        <div className="dialog-heading">
          <div>
            <h2>Export audio</h2>
            <p>Render your current layer stack to a new WAV.</p>
          </div>
          <button
            aria-label="Close export"
            onClick={() => {
              if (exporting) engine.cancelExport();
              else setExportOpen(false);
            }}
          >
            <X size={18} />
          </button>
        </div>
        <label className="select-field">
          <span>Range</span>
          <select
            aria-label="Export range"
            disabled={exporting}
            value={exportRange}
            onChange={(e) => setExportRange(e.target.value as 'all' | 'selection')}
          >
            <option value="all">Whole source</option>
            <option value="selection" disabled={!selection}>
              Selection time range
            </option>
          </select>
        </label>
        <label className="select-field">
          <span>Precision</span>
          <select
            aria-label="Export precision"
            disabled={exporting}
            value={exportBits}
            onChange={(e) => setExportBits(+e.target.value)}
          >
            <option value={32}>32-bit float WAV</option>
            <option value={64}>64-bit float WAV</option>
          </select>
        </label>
        <div className="export-summary">
          <span>Sample rate</span>
          <strong>{info?.sampleRate.toLocaleString()} Hz · original rate</strong>
          <span>Channels</span>
          <strong>{info?.channels === 1 ? 'Mono' : 'Stereo · preserved'}</strong>
          <span>Processing</span>
          <strong>{layers.filter((l) => l.enabled).length} enabled spectral layers</strong>
        </div>
        <p className="caption">
          Monitor volume and display settings are excluded. Float WAV preserves headroom. Choose
          64-bit float to retain decoded 32-bit PCM precision.
        </p>
        {exporting ? (
          <div className="export-progress">
            <progress value={exportProgress} max={1} />
            <span>Rendering {Math.round(exportProgress * 100)}%</span>
          </div>
        ) : null}
        {exportError && (
          <div className="export-error" role="alert">
            {exportError}
          </div>
        )}
        <div className="dialog-actions">
          <button
            className="quiet-button"
            onClick={() => {
              if (exporting) engine.cancelExport();
              else setExportOpen(false);
            }}
          >
            {exporting ? 'Cancel export' : 'Cancel'}
          </button>
          <button
            className="primary-button"
            disabled={exporting}
            onClick={() => void exportAudio()}
          >
            {exporting ? <LoaderCircle size={16} className="spinning" /> : <Download size={16} />}
            Export WAV
          </button>
        </div>
      </dialog>
    </div>
  );
}
