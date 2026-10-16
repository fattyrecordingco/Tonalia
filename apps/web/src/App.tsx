import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { version } from '../../../package.json';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
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
import { useSession } from './engine/session';
import { checkpoint, versions, type Recovery } from './engine/recovery';
import { zoomTime, clampView } from './engine/navigation';
import { AudioEngine, calibrationFile } from './engine/client';
import { SpectralCanvas, type Overview } from './components/SpectralCanvas';
import { NumberField } from './components/NumberField';
import { SpectrumPlot } from './components/SpectrumPlot';
import { SeparationPanel } from './components/SeparationPanel';
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
  Processor,
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
    !(
      (p.schema === 1 && p.engine === 'spectral-gain-v1') ||
      (p.schema === 2 && p.engine === 'spectral-edit-v2')
    ) ||
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
  const [hardness, setHardness] = useState(0.3);
  const [noiseProfile, setNoiseProfile] = useState<number[] | null>(null);
  const [capturingNoise, setCapturingNoise] = useState(false);
  const [sensitivity, setSensitivity] = useState(3);
  const sourceGeneration = useRef(0);
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
    [tab, setTab] = useState<'edit' | 'restore' | 'analyze' | 'collaborate'>('edit');
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(false),
    [dirty, setDirty] = useState(false),
    [dragging, setDragging] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [separationOpen, setSeparationOpen] = useState(false);
  const shortcutsRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (shortcutsOpen) shortcutsRef.current?.showModal();
    else shortcutsRef.current?.close();
  }, [shortcutsOpen]);
  const [exportError, setExportError] = useState('');
  const [exportMode, setExportMode] = useState<Monitor>('result');
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
  const applyShared = useCallback(
    (next: Layer[]) => {
      void stop();
      setHistory({ past: [], present: next, future: [] });
      setSelection(null);
      setSelectedId(null);
      setDirty(true);
    },
    [stop],
  );
  const session = useSession(
    info && fingerprint
      ? {
          sha256: fingerprint,
          frames: info.frames,
          sampleRate: info.sampleRate,
          channels: info.channels,
        }
      : null,
    applyShared,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [lan, setLan] = useState(false),
    [invite, setInvite] = useState(''),
    [hostAddress, setHostAddress] = useState('127.0.0.1');
  const [recoveryList, setRecoveryList] = useState<Recovery[]>([]),
    [recoveryOpen, setRecoveryOpen] = useState(false);
  const recoveryRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (recoveryOpen) recoveryRef.current?.showModal();
    else recoveryRef.current?.close();
  }, [recoveryOpen]);
  const manifest = useCallback(
    (): Project | null =>
      info && fingerprint
        ? {
            format: 'tonalia',
            schema: 2,
            engine: 'spectral-edit-v2',
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
          }
        : null,
    [info, fingerprint, layers, view],
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      const p = manifest();
      if (p)
        void checkpoint(p).catch(() =>
          notify('Local recovery storage is unavailable. Save a project file to keep your edits.'),
        );
    }, 1500);
    return () => clearTimeout(timer);
  }, [manifest, notify]);
  const showRecovery = async () => {
    try {
      setRecoveryList(await versions());
      setRecoveryOpen(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const commit = useCallback(
    (next: Layer[], message?: string) => {
      if (sessionRef.current.connection) {
        void sessionRef.current.submit(next);
        return;
      }
      void stop();
      setHistory((h) => ({ past: [...h.past.slice(-99), h.present], present: next, future: [] }));
      setDirty(true);
      if (message) notify(message);
    },
    [stop, notify],
  );
  const undo = useCallback(() => {
    if (sessionRef.current.connection || !history.past.length) return;
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
    if (sessionRef.current.connection || !history.future.length) return;
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
      if (sessionRef.current.connection) await sessionRef.current.leave();
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
        sourceGeneration.current++;
        setNoiseProfile(null);
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
    if (info)
      setView((v) => ({
        ...v,
        start: 0,
        end: info.frames,
        low: v.log ? 20 : 0,
        high: info.sampleRate / 2,
      }));
  }, [info]);
  const fitSelection = useCallback(() => {
    if (!selection || !info) return;
    const b = maskBounds(selection);
    const margin = Math.max(256, (b.end - b.start) * 0.08);
    setView((v) => ({
      ...v,
      start: Math.max(0, b.start - margin),
      end: Math.min(info.frames, b.end + margin),
      low: Math.max(v.log ? 20 : 0, b.low - Math.max(1, (b.high - b.low) * 0.08)),
      high: Math.min(
        info.sampleRate / 2,
        Math.max(v.log ? 21 : 1, b.high + Math.max(1, (b.high - b.low) * 0.08)),
      ),
    }));
  }, [selection, info]);
  const applyGain = useCallback(async () => {
    if (!selection || !info) return;
    if (selectedId && layers.find((l) => l.id === selectedId)?.processor) {
      setError(
        'Use the Restore panel to update this restoration layer, or choose a new selection for a gain layer.',
      );
      return;
    }
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
  const [restoreKind, setRestoreKind] = useState<Processor['kind']>('spectralGate');
  const [threshold, setThreshold] = useState(-45);
  const [reduction, setReduction] = useState(18);
  const [humHz, setHumHz] = useState(50);
  const [neuralStrength, setNeuralStrength] = useState(0.8);
  const captureNoise = async () => {
    if (!selection || !info || capturingNoise) return;
    const generation = sourceGeneration.current;
    setCapturingNoise(true);
    setError('');
    try {
      const b = maskBounds(selection);
      const profile = await engine.call<number[]>('noiseProfile', { start: b.start, end: b.end });
      if (generation === sourceGeneration.current) {
        setNoiseProfile(profile);
        notify(
          'Noise profile captured. Select the audio to clean, or select the entire recording.',
        );
      }
    } catch (e) {
      if (generation === sourceGeneration.current) setError(String(e));
    } finally {
      setCapturingNoise(false);
    }
  };
  const applyRestoration = async () => {
    if (!info || !selection) return;
    if (restoreKind === 'noiseReduction' && !noiseProfile) return;
    try {
      const timeOnly = restoreKind === 'interpolate' || restoreKind === 'neuralSpeechV1';
      const bounds = maskBounds(selection);
      const processor: Processor =
        restoreKind === 'noiseReduction'
          ? {
              kind: restoreKind,
              profileDb: noiseProfile!,
              reductionDb: reduction,
              sensitivityDb: sensitivity,
            }
          : restoreKind === 'spectralGate'
            ? { kind: restoreKind, thresholdDb: threshold, reductionDb: reduction }
            : restoreKind === 'hum'
              ? {
                  kind: restoreKind,
                  frequency: humHz,
                  widthHz: info.sampleRate / 2048,
                  reductionDb: reduction,
                }
              : restoreKind === 'neuralSpeechV1'
                ? { kind: restoreKind, strength: neuralStrength }
                : { kind: restoreKind };
      const labels = {
        noiseReduction: 'Noise reduction',
        spectralGate: 'Spectral gate',
        hum: 'Harmonic hum attenuation',
        interpolate: 'Short-click interpolation',
        neuralSpeechV1: 'Neural speech denoise',
      };
      const mask: Mask = timeOnly
        ? {
            channel: selection.channel,
            featherHz: 0,
            featherTime: 0,
            shape: {
              kind: 'rectangle',
              start: Math.max(0, Math.floor(bounds.start)),
              end: Math.min(info.frames, Math.ceil(bounds.end)),
              low: 0,
              high: info.sampleRate / 2,
            },
          }
        : structuredClone(selection);
      const layer: Layer = {
        id: crypto.randomUUID(),
        name: labels[restoreKind],
        enabled: true,
        gainDb: 0,
        processor,
        mask,
      };
      const next = [...layers, layer];
      await engine.call('validate', { layers: next });
      commit(next, 'Restoration layer created. Audition Result and Removed before exporting.');
      setSelectedId(layer.id);
      setSelection(mask);
    } catch (e) {
      setError(String(e));
    }
  };
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
      schema: 2,
      engine: 'spectral-edit-v2',
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
        if (sessionRef.current.connection) await sessionRef.current.leave();
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
        e.isComposing ||
        (e.target instanceof HTMLElement &&
          e.target.closest('input, textarea, select, [contenteditable="true"], dialog')) ||
        document.querySelector('dialog[open]')
      )
        return;
      const cmd = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      let handled = true;
      if (cmd && k === 'z') {
        if (!e.repeat) {
          if (e.shiftKey) redo();
          else undo();
        }
      } else if (cmd && k === 'y') {
        if (!e.repeat) redo();
      } else if (cmd && k === 's') {
        if (!e.repeat) void saveProject();
      } else if (cmd && k === 'o') {
        if (!e.repeat) void chooseAudio();
      } else if (cmd && k === 'e') {
        if (info && !e.repeat) {
          setExportMode(mode);
          setExportOpen(true);
        }
      } else if (cmd && k === 'a') {
        if (info)
          setRegion({
            shape: {
              kind: 'rectangle',
              start: 0,
              end: info.frames,
              low: 0,
              high: info.sampleRate / 2,
            },
            channel,
            featherTime: 0,
            featherHz: 0,
          });
      } else if (cmd && k === 'enter') {
        if (!e.repeat) void applyGain();
      } else if (e.code === 'Space') {
        if (!e.repeat) void play();
      } else if (k === 'escape') {
        setRegion(null);
        setProjectMenu(false);
      } else if (k === '?' && !cmd) setShortcutsOpen(true);
      else if ((e.shiftKey && e.code === 'Digit1') || k === '0') fit();
      else if (e.shiftKey && e.code === 'Digit2') fitSelection();
      else if (k === '+' || k === '=' || k === '-') {
        if (info) setView((v) => zoomTime(v, info.frames, k === '-' ? 2 : 0.5));
      } else if (k === 'home' || k === 'end') {
        if (info) seek(k === 'home' ? 0 : info.frames);
      } else if (k === 'arrowleft' || k === 'arrowright') {
        if (info)
          setView((v) => {
            const d = (v.end - v.start) * (k === 'arrowleft' ? -0.1 : 0.1);
            return clampView({ ...v, start: v.start + d, end: v.end + d }, info.frames);
          });
      } else if ((k === 'delete' || k === 'backspace') && selectedId) {
        if (!e.repeat) {
          commit(layers.filter((l) => l.id !== selectedId));
          setSelectedId(null);
        }
      } else if (!cmd && !e.altKey) {
        const t = tools.find((t) => t.key.toLowerCase() === k);
        if (t) setTool(t.id);
        else if (k === '[') setBrushSize((v) => Math.max(2, v - (e.shiftKey ? 1 : 4)));
        else if (k === ']') setBrushSize((v) => Math.min(160, v + (e.shiftKey ? 1 : 4)));
        else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
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
      const result = await engine.export(name, layers, a, b, exportBits, exportMode);
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
    setTab(l.processor ? 'restore' : 'edit');
    if (l.processor) {
      const p = l.processor;
      setRestoreKind(p.kind);
      if ('reductionDb' in p) setReduction(p.reductionDb);
      if (p.kind === 'noiseReduction') {
        setNoiseProfile([...p.profileDb]);
        setSensitivity(p.sensitivityDb);
      } else if (p.kind === 'spectralGate') setThreshold(p.thresholdDb);
      else if (p.kind === 'hum') setHumHz(p.frequency);
      else if (p.kind === 'neuralSpeechV1') setNeuralStrength(p.strength);
    }
  };
  const reorder = (index: number, direction: number) => {
    const next = [...layers];
    const other = index + direction;
    if (other < 0 || other >= next.length) return;
    [next[index], next[other]] = [next[other], next[index]];
    commit(next);
  };
  const wholePeak = stats ? Math.max(...stats.channels.map((c) => c.peak)) : 0;
  const handleNativeDrop = useRef<(paths: string[]) => Promise<void>>(async () => {});
  handleNativeDrop.current = async (paths) => {
    setDragging(false);
    if (paths.length !== 1) {
      setError('Drop one WAV or Tonalia project at a time.');
      return;
    }
    const path = paths[0];
    try {
      if (/\.json$/i.test(path)) await loadProject(await invoke<string>('read_project', { path }));
      else if (/\.(wav|wave)$/i.test(path))
        await openSource(await invoke<SourceRef>('open_source', { path }));
      else setError('Drop a WAV (.wav or .wave) or Tonalia project (.json).');
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (disposed) return;
        if (payload.type === 'enter' || payload.type === 'over') setDragging(true);
        else if (payload.type === 'leave') setDragging(false);
        else if (payload.type === 'drop') void handleNativeDrop.current(payload.paths);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length !== 1) {
          setError('Drop one WAV or Tonalia project at a time.');
          return;
        }
        const file = e.dataTransfer.files[0];
        if (file) {
          if (/\.json$/i.test(file.name)) {
            if (file.size > 4 * 1024 * 1024)
              setError('The project exceeds the 4 MiB manifest limit.');
            else
              void file
                .text()
                .then(loadProject)
                .catch((e) => setError(String(e)));
          } else if (/\.(wav|wave)$/i.test(file.name)) void openSource({ kind: 'browser', file });
          else setError('Drop a WAV (.wav or .wave) or Tonalia project (.json).');
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
          <button className="quiet-button" onClick={() => void showRecovery()}>
            History
          </button>
          <button
            className="quiet-button"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutsOpen(true)}
          >
            Shortcuts
          </button>
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
            className="quiet-button separation-launch"
            onClick={() => setSeparationOpen(true)}
            disabled={loading || exporting}
          >
            <AudioLines size={16} /> Separate sounds
          </button>
          <button
            className="export-button"
            onClick={() => {
              setExportError('');
              setExportMode(mode);
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
                min="2"
                max="160"
                value={brushSize}
                onChange={(e) => setBrushSize(+e.target.value)}
              />
              <span>{brushSize}px</span>
            </label>
            <label className="inline-control">
              Hardness
              <input
                aria-label="Brush hardness"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={hardness}
                onChange={(e) => setHardness(+e.target.value)}
              />
              <span>{Math.round(hardness * 100)}%</span>
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
            disabled={!!session.connection || !history.past.length}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl+Shift+Z)"
            onClick={redo}
            disabled={!!session.connection || !history.future.length}
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
            <span className="session-badge">
              {session.connection ? `Shared · r${session.revision}` : 'Local'}
            </span>
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
                        {l.processor
                          ? {
                              noiseReduction: 'Captured noise profile',
                              spectralGate: 'Spectral gate',
                              hum: 'Harmonic notches',
                              interpolate: 'Time interpolation',
                              neuralSpeechV1: 'Offline neural model',
                            }[l.processor.kind]
                          : `${l.gainDb > 0 ? '+' : ''}${l.gainDb.toFixed(1)} dB`}{' '}
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
            hardness={hardness}
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
            <button
              role="tab"
              aria-selected={tab === 'restore'}
              className={tab === 'restore' ? 'active' : ''}
              onClick={() => setTab('restore')}
            >
              Restore
            </button>
            <button
              role="tab"
              aria-selected={tab === 'collaborate'}
              className={tab === 'collaborate' ? 'active' : ''}
              onClick={() => setTab('collaborate')}
            >
              Share
            </button>
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
            ) : tab === 'restore' ? (
              <div className="inspector-section">
                <h3>Reversible restoration</h3>
                <label className="field-label">
                  Operation
                  <select
                    aria-label="Restoration operation"
                    value={restoreKind}
                    onChange={(e) => setRestoreKind(e.target.value as Processor['kind'])}
                  >
                    <option value="noiseReduction">Noise reduction (captured profile)</option>
                    <option value="spectralGate">Spectral gate</option>
                    <option value="hum">Harmonic hum attenuation</option>
                    <option value="interpolate">Short-click interpolation</option>
                    <option value="neuralSpeechV1">Offline neural speech denoise</option>
                  </select>
                </label>
                {restoreKind === 'noiseReduction' && (
                  <>
                    <p className="caption">
                      Select a noise-only passage (2048 samples to 10 seconds), then capture its
                      profile from the original audio. Next select the region to clean.
                    </p>
                    <button
                      className="quiet-button full-width"
                      disabled={!info || !selection || capturingNoise || loading || exporting}
                      onClick={() => void captureNoise()}
                    >
                      {capturingNoise
                        ? 'Capturing noise…'
                        : noiseProfile
                          ? 'Recapture noise profile'
                          : 'Capture noise profile'}
                    </button>
                    <p className="caption" role="status">
                      {noiseProfile
                        ? 'Noise profile ready · saved with each noise reduction layer.'
                        : 'No noise profile captured.'}
                    </p>
                    <button
                      className="quiet-button full-width"
                      disabled={!info}
                      onClick={() => {
                        if (info)
                          setRegion({
                            shape: {
                              kind: 'rectangle',
                              start: 0,
                              end: info.frames,
                              low: 0,
                              high: info.sampleRate / 2,
                            },
                            channel,
                            featherTime: 0,
                            featherHz: 0,
                          });
                      }}
                    >
                      Select entire recording
                    </button>
                    <NumberField
                      label="Noise sensitivity"
                      value={sensitivity}
                      min={-12}
                      max={24}
                      digits={1}
                      unit="dB"
                      onCommit={setSensitivity}
                    />
                  </>
                )}
                {restoreKind === 'spectralGate' && (
                  <NumberField
                    label="Gate threshold"
                    value={threshold}
                    min={-120}
                    max={0}
                    digits={1}
                    unit="dBFS"
                    onCommit={setThreshold}
                  />
                )}
                {(restoreKind === 'spectralGate' ||
                  restoreKind === 'hum' ||
                  restoreKind === 'noiseReduction') && (
                  <NumberField
                    label="Maximum reduction"
                    value={reduction}
                    min={0}
                    max={60}
                    digits={1}
                    unit="dB"
                    onCommit={setReduction}
                  />
                )}
                {restoreKind === 'hum' && (
                  <NumberField
                    label="Hum fundamental"
                    value={humHz}
                    min={20}
                    max={200}
                    digits={1}
                    unit="Hz"
                    onCommit={setHumHz}
                  />
                )}
                {restoreKind === 'neuralSpeechV1' && (
                  <NumberField
                    label="Neural strength"
                    value={neuralStrength}
                    min={0}
                    max={1}
                    digits={2}
                    unit=""
                    onCommit={setNeuralStrength}
                  />
                )}
                <p className="caption">
                  {restoreKind === 'noiseReduction'
                    ? 'Reduces the captured noise spectrum with a per-channel spectral subtraction filter. Higher sensitivity removes more; maximum reduction limits attenuation. Audition Result and Removed to check detail.'
                    : restoreKind === 'spectralGate'
                      ? 'Attenuates bins below a calibrated threshold with a 12 dB soft knee. This is a spectral gate, not learned noise-profile subtraction.'
                      : restoreKind === 'hum'
                        ? 'FFT harmonic notches at the fundamental and its multiples. Width is one processing FFT bin; low-frequency resolution is limited.'
                        : restoreKind === 'interpolate'
                          ? 'Replaces a short click with a line between intact neighboring samples. Select at most 10 ms, away from source edges. Uses the full frequency band.'
                          : 'Experimental RNNoise speech model included in the app. Runs offline at 48 kHz, independently per channel. Full-band time selection; fixed context and delay compensation. May alter music or speech; always audition.'}
                </p>
                <button
                  className="apply-button"
                  disabled={
                    !info ||
                    !selection ||
                    exporting ||
                    !!pendingProject ||
                    capturingNoise ||
                    (restoreKind === 'noiseReduction' && !noiseProfile)
                  }
                  onClick={() => void applyRestoration()}
                >
                  <Plus size={15} />
                  Create restoration layer
                </button>
                <p className="caption">
                  Layers can be bypassed, reordered, undone and saved. Creating a restoration always
                  adds a new layer; delete and recreate it to change parameters.
                </p>
              </div>
            ) : tab === 'collaborate' ? (
              <div className="inspector-section">
                <h3>Local-network co-editing</h3>
                <p className="caption">
                  Experimental. Each participant opens the identical WAV locally. Only layer graphs
                  are sent; audio stays on each computer. Accepted revisions are serialized by the
                  host. Shared undo is disabled.
                </p>
                {!isNative() ? (
                  <p className="caption">Use the installed desktop app to host or join.</p>
                ) : session.connection ? (
                  <>
                    <p>
                      Connected · revision {session.revision}
                      {session.busy ? ' · awaiting acknowledgment' : ''}
                    </p>
                    {session.connection.host && (
                      <>
                        <label>
                          Host LAN IP
                          <input
                            aria-label="Host LAN IP"
                            value={hostAddress}
                            onChange={(e) => setHostAddress(e.target.value)}
                          />
                        </label>
                        <p className="caption">
                          For another computer, enter this host’s private IP. The listener must have
                          been started with LAN access.
                        </p>
                        <textarea
                          aria-label="Session invite"
                          readOnly
                          rows={4}
                          value={JSON.stringify({
                            endpoint: session.connection.endpoint.replace(
                              '127.0.0.1',
                              hostAddress.trim(),
                            ),
                            token: session.connection.token,
                          })}
                        />
                      </>
                    )}
                    <button
                      className="quiet-button"
                      onClick={() => void session.leave().catch((e) => setError(String(e)))}
                    >
                      Leave session{session.connection.host ? ' and stop host' : ''}
                    </button>
                  </>
                ) : (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={lan}
                        onChange={(e) => setLan(e.target.checked)}
                      />{' '}
                      Allow private LAN connections
                    </label>
                    <p className="caption">
                      LAN sessions use unencrypted HTTP and a secret invite token. Share only on a
                      trusted network. No port forwarding; no hosted service.
                    </p>
                    <button
                      className="apply-button"
                      disabled={!fingerprint || exporting}
                      onClick={() =>
                        void session.host(layers, lan).catch((e) => setError(String(e)))
                      }
                    >
                      Host session
                    </button>
                    <label>
                      Paste invite
                      <textarea
                        aria-label="Paste session invite"
                        rows={4}
                        value={invite}
                        onChange={(e) => setInvite(e.target.value)}
                      />
                    </label>
                    <button
                      className="quiet-button"
                      disabled={!fingerprint || !invite || exporting}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Join this session and replace your current layer graph with the host’s graph? Save your project first.',
                          )
                        )
                          void session.join(invite).catch((e) => setError(String(e)));
                      }}
                    >
                      Join session
                    </button>
                  </>
                )}
                <p className="caption" role="status">
                  {session.status}
                </p>
                {session.hasConflict && (
                  <button
                    className="quiet-button"
                    onClick={() => {
                      const p = manifest();
                      if (p && session.conflict.current) {
                        const blob = new Blob(
                          [JSON.stringify({ ...p, layers: session.conflict.current }, null, 2)],
                          { type: 'application/json' },
                        );
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'Tonalia-rejected-proposal.tonalia';
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 30000);
                      }
                    }}
                  >
                    Download rejected proposal
                  </button>
                )}
              </div>
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
                  {[512, 1024, 2048, 4096, 8192, 16384].map((n) => (
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
                      low:
                        e.target.value === 'log'
                          ? Math.min(Math.max(20, v.low), (info?.sampleRate || 48000) / 2 - 1)
                          : v.low,
                      high: Math.max(v.high, e.target.value === 'log' ? 21 : 1),
                    }))
                  }
                >
                  <option value="log">Logarithmic</option>
                  <option value="linear">Linear</option>
                </select>
              </label>
              <div className="field-grid">
                <NumberField
                  label="View low frequency"
                  value={view.low}
                  min={view.log ? 20 : 0}
                  max={view.high - 0.01}
                  digits={1}
                  unit="Hz"
                  disabled={!info}
                  onCommit={(low) => setView((v) => ({ ...v, low }))}
                />
                <NumberField
                  label="View high frequency"
                  value={view.high}
                  min={view.low + 0.01}
                  max={info ? info.sampleRate / 2 : 24000}
                  digits={1}
                  unit="Hz"
                  disabled={!info}
                  onCommit={(high) => setView((v) => ({ ...v, high }))}
                />
              </div>
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
          Tonalia {version} <span className="status-divider" /> Development build
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
      <SeparationPanel
        open={separationOpen}
        onClose={() => setSeparationOpen(false)}
        source={engine.currentSource}
        info={info}
        fingerprint={fingerprint}
        selection={selection}
        bounds={bounds}
        beforePreview={stop}
        onOpenTrack={async (path) => {
          await openSource(await invoke<SourceRef>('open_source', { path }));
        }}
        onSelect={(mask) => {
          setRegion(mask);
          if (info) {
            const b = maskBounds(mask);
            setView((v) => ({
              ...v,
              start: Math.max(0, b.start - info.sampleRate * 0.05),
              end: Math.min(info.frames, b.end + info.sampleRate * 0.05),
            }));
          }
        }}
      />
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
            <p>Export the result, the removed signal, or the original audio.</p>
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
          <span>Signal</span>
          <select
            aria-label="Export signal"
            disabled={exporting}
            value={exportMode}
            onChange={(e) => setExportMode(e.target.value as Monitor)}
          >
            <option value="result">Result · edited recording</option>
            <option value="removed">Removed · isolated layer difference</option>
            <option value="original">Original · unprocessed recording</option>
          </select>
        </label>
        {exportMode === 'removed' && (
          <p className="caption">
            Exports exactly the Removed signal: original minus the result of all enabled layers.
            Bypassed layers are excluded. With no active edits this is silence.
          </p>
        )}
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
      <dialog
        ref={recoveryRef}
        onClose={() => setRecoveryOpen(false)}
        aria-label="Local version history"
      >
        <div className="section-heading">
          <h2>Local recovery history</h2>
          <button aria-label="Close history" onClick={() => setRecoveryOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <p className="caption">
          Up to 20 local layer checkpoints, saved after 1.5 seconds of inactivity. Original WAV
          files are required. Browser/app storage can be cleared; keep project backups.
        </p>
        {recoveryList.length === 0 && <p>No recovery checkpoints yet.</p>}
        {recoveryList.map((entry) => (
          <div className="recovery-row" key={entry.id}>
            <span>
              {entry.project.source.name}
              <small>
                {new Date(entry.time).toLocaleString()} · {entry.project.layers.length} layers
              </small>
            </span>
            <button
              className="quiet-button"
              onClick={() => {
                setRecoveryOpen(false);
                void loadProject(JSON.stringify(entry.project));
              }}
            >
              Restore
            </button>
          </div>
        ))}
      </dialog>
      <dialog
        ref={shortcutsRef}
        onClose={() => setShortcutsOpen(false)}
        aria-label="Keyboard shortcuts"
      >
        <div className="section-heading">
          <h2>Keyboard & navigation</h2>
          <button aria-label="Close shortcuts" onClick={() => setShortcutsOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <p className="caption">
          Use Ctrl on Windows/Linux or ⌘ on macOS. Shortcuts pause while typing or using a dialog.
        </p>
        <dl className="shortcut-list">
          {[
            ['Space', 'Play / stop'],
            ['T / M / L / B / H', 'Time / rectangle / lasso / brush / hand'],
            ['+ / −', 'Zoom time in / out'],
            ['0 or Shift+1', 'Fit source'],
            ['Shift+2', 'Fit selection'],
            ['← / →', 'Pan time'],
            ['Home / End', 'Seek source start / end'],
            ['[ / ]', 'Brush size'],
            ['Ctrl+O / Ctrl+S / Ctrl+E', 'Open WAV / save project / export'],
            ['Ctrl+A', 'Select the full source'],
            ['Ctrl+Enter', 'Apply gain layer'],
            ['Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', 'Undo / redo'],
            ['Delete', 'Delete selected layer'],
            ['Escape', 'Clear selection / close dialog'],
            ['Wheel / trackpad pinch', 'Zoom at pointer'],
            ['Shift+wheel / horizontal scroll', 'Pan time'],
            ['Alt+wheel', 'Zoom frequency at pointer'],
            ['Alt+Shift+wheel / vertical hand drag', 'Pan frequency'],
          ].map(([keys, action]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </dialog>
    </div>
  );
}
