import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open as chooseFolder } from '@tauri-apps/plugin-dialog';
import {
  AudioLines,
  Download,
  LoaderCircle,
  Play,
  Square,
  X,
  Scissors,
  ScanSearch,
  Music2,
  Sparkles,
} from 'lucide-react';
import { AudioEngine } from '../engine/client';
import { formatTime, isNative, type Mask, type SourceRef, type WavInfo } from '../types';
import assets from '../../../../tools/audio-ai/models.json';

type Mode = 'auto' | 'music' | 'sound' | 'identify' | 'transients';
interface Status {
  pythonAvailable: boolean;
  runtimeReady: boolean;
  music: boolean;
  sound: boolean;
  identify: boolean;
  busy: boolean;
}
interface Track {
  id: string;
  name: string;
  path: string;
  peak: number;
  frames: number;
  sampleRate: number;
  channels: number;
}
interface SoundEvent {
  start: number;
  end: number;
  label: string;
  kind: 'sound' | 'transient';
  confidence?: number;
  classId?: string;
  matches: { label: string; similarity: number }[];
}
interface Result {
  id: string;
  mode: Mode;
  sourceName: string;
  sourcePath: string;
  sourceHash: string;
  offsetSeconds: number;
  duration: number;
  tracks: Track[];
  events: SoundEvent[];
  sources?: { classId: string; label: string; confidence: number; seconds: number }[];
  cleanup?: number;
}
const modes = [
  {
    id: 'auto',
    name: 'Auto separate',
    icon: ScanSearch,
    description:
      'Analyse the recording, extract up to eight detected sources into tracks, and clean spectral bleed automatically.',
  },
  {
    id: 'music',
    name: 'Music stems',
    icon: Music2,
    description: 'Split a song into vocals, drums, bass, guitar, piano and other instruments.',
  },
  {
    id: 'sound',
    name: 'Isolate a sound',
    icon: Sparkles,
    description:
      'Describe what you want to hear, one sound per line. Create separate target tracks and a residual.',
  },
  {
    id: 'identify',
    name: 'Find sounds',
    icon: ScanSearch,
    description:
      'Detect recorded sounds and their timing. Suggestions appear only when the analysis meets your confidence threshold.',
  },
  {
    id: 'transients',
    name: 'Tiny clicks',
    icon: Scissors,
    description:
      'Find brief changes and extract their spectral detail while suppressing the continuous background.',
  },
] as const;
export function SeparationPanel(p: {
  open: boolean;
  onClose: () => void;
  source: SourceRef | null;
  info: WavInfo | null;
  fingerprint: string;
  selection: Mask | null;
  bounds: { start: number; end: number };
  onOpenTrack: (path: string) => Promise<void>;
  onSelect: (mask: Mask) => void;
  beforePreview: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>('auto');
  const [range, setRange] = useState<'source' | 'selection'>('source');
  const [prompt, setPrompt] = useState('');
  const [sensitivity, setSensitivity] = useState(0.6);
  const [cleanup, setCleanup] = useState(0.55);
  const [confidence, setConfidence] = useState(0.35);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const preview = useRef<AudioEngine | null>(null);
  const job = useRef('');
  const mounted = useRef(true);
  const refresh = async () => {
    if (isNative()) setStatus(await invoke<Status>('ai_status'));
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      preview.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (p.open) {
      dialog.current?.showModal();
      void refresh().catch((e) => setError(String(e)));
    } else {
      dialog.current?.close();
      void preview.current?.stop();
      setPreviewId(null);
    }
  }, [p.open]);
  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ jobId: string; message: string; progress: number | null }>(
      'separation-progress',
      ({ payload }) => {
        if (payload.jobId === job.current && !disposed) {
          setMessage(payload.message);
          setProgress(payload.progress);
        }
      },
    ).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const readyFor = (choice: Mode) =>
    !!status?.runtimeReady &&
    (choice === 'transients' ||
      (choice === 'auto' ? status.music && status.sound && status.identify : !!status[choice]));
  const ready = readyFor(mode);
  const suggestions =
    results.find(
      (entry) =>
        entry.sourceHash === p.fingerprint && (entry.mode === 'auto' || entry.mode === 'identify'),
    )?.sources || [];
  const start = range === 'selection' ? Math.max(0, Math.floor(p.bounds.start)) : 0;
  const end =
    range === 'selection'
      ? Math.min(p.info?.frames || 0, Math.ceil(p.bounds.end))
      : p.info?.frames || 0;
  const duration = p.info ? (end - start) / p.info.sampleRate : 0;
  const canRun =
    p.source?.kind === 'native' &&
    !!p.fingerprint &&
    !!p.info &&
    duration > 0 &&
    duration <= 600 &&
    (range !== 'selection' || !!p.selection);
  const run = async (
    install = false,
    override?: { mode: Mode; prompts?: string[]; start: number; end: number },
  ) => {
    if (busy || (!install && !canRun)) return;
    const source = p.source;
    const operation = override?.mode || mode;
    const descriptions =
      override?.prompts ||
      prompt
        .split('\n')
        .map((text) => text.trim())
        .filter(Boolean);
    job.current = crypto.randomUUID();
    setBusy(true);
    setError('');
    setProgress(null);
    setMessage(install ? 'Preparing local AI tools…' : 'Starting local analysis…');
    try {
      await preview.current?.stop();
      setPreviewId(null);
      if (install) {
        await invoke('ai_prepare', { pack: operation, jobId: job.current });
        await refresh();
        setMessage('Local AI pack is ready.');
      } else if (source?.kind === 'native') {
        if (!readyFor(operation)) {
          await invoke('ai_prepare', { pack: operation, jobId: job.current });
          await refresh();
        }
        const output = await invoke<Result>('ai_start', {
          id: source.id,
          jobId: job.current,
          request: {
            mode: operation,
            start: override?.start ?? start,
            end: override?.end ?? end,
            prompt: operation === 'sound' ? descriptions[0] || '' : '',
            prompts: operation === 'sound' ? descriptions : [],
            sensitivity,
            cleanup,
            confidence,
            sourceHash: p.fingerprint,
          },
        });
        if (mounted.current) {
          setResult(output);
          setResults((list) => [output, ...list].slice(0, 20));
          setMessage(
            output.tracks.length
              ? `${output.tracks.length} tracks ready.${output.mode === 'auto' && !output.sources?.length ? ' No sources met the confidence threshold; audio is in the residual.' : ''}`
              : `${output.sources?.length || 0} source suggestions from ${output.events.length} detected regions.`,
          );
        }
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) {
        setBusy(false);
        setProgress(null);
        void refresh().catch(() => {});
      }
    }
  };
  const audition = async (track: Track) => {
    setError('');
    try {
      if (previewId === track.id) {
        await preview.current?.stop();
        setPreviewId(null);
        return;
      }
      await p.beforePreview();
      if (!preview.current) {
        preview.current = new AudioEngine();
        await preview.current.init();
      }
      const engine = preview.current;
      await engine.stop();
      engine.onPosition = (position, playing) => {
        setPreviewTime(position / track.sampleRate);
        if (!playing) setPreviewId(null);
      };
      engine.onError = (message) => {
        setError(message);
        setPreviewId(null);
      };
      const ref = await invoke<SourceRef>('open_source', { path: track.path });
      await engine.load(ref);
      setPreviewTime(0);
      setPreviewId(track.id);
      await engine.play(0, track.frames, [], 'result', 0.25, false);
    } catch (e) {
      setError(String(e));
      setPreviewId(null);
    }
  };
  const openTrack = async (path: string) => {
    try {
      await preview.current?.stop();
      setPreviewId(null);
      await p.onOpenTrack(path);
      p.onClose();
    } catch (e) {
      setError(String(e));
    }
  };
  const exportAll = async () => {
    if (!result) return;
    try {
      const destination = await chooseFolder({
        directory: true,
        multiple: false,
        title: 'Export separated WAV tracks',
      });
      if (typeof destination !== 'string') return;
      const count = await invoke<number>('ai_export_tracks', { jobId: result.id, destination });
      setMessage(`Exported ${count} WAV tracks in a new Tonalia folder.`);
    } catch (e) {
      setError(String(e));
    }
  };
  const selectEvent = (event: SoundEvent) => {
    if (!p.info || !result || result.sourceHash !== p.fingerprint) return;
    const start = Math.max(0, Math.floor((event.start + result.offsetSeconds) * p.info.sampleRate));
    const end = Math.min(
      p.info.frames,
      Math.ceil((event.end + result.offsetSeconds) * p.info.sampleRate),
    );
    p.onSelect({
      shape: { kind: 'rectangle', start, end, low: 0, high: p.info.sampleRate / 2 },
      channel: null,
      featherTime: 0,
      featherHz: 0,
    });
    p.onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="separation-dialog"
      aria-label="Separate sounds"
      onCancel={() => p.onClose()}
    >
      <div className="separation-heading">
        <div>
          <span className="eyebrow">Local audio analysis</span>
          <h2>Separate sounds</h2>
          <p>Find the detail. Give it its own track.</p>
        </div>
        <button aria-label="Close separation workspace" onClick={p.onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="separation-body">
        <section className="separation-controls" aria-label="Separation settings">
          <div className="separation-modes" role="tablist" aria-label="Separation modes">
            {modes.map((item) => (
              <button
                role="tab"
                aria-selected={mode === item.id}
                className={mode === item.id ? 'active' : ''}
                key={item.id}
                disabled={busy}
                onClick={() => setMode(item.id)}
              >
                <item.icon size={17} />
                {item.name}
              </button>
            ))}
          </div>
          <p className="separation-description">
            {modes.find((item) => item.id === mode)?.description}
          </p>
          {!isNative() ? (
            <p className="separation-note">
              AI source separation runs in the Tonalia desktop app. Open this recording there to use
              local models.
            </p>
          ) : (
            <>
              <label className="select-field">
                <span>Audio range</span>
                <select
                  aria-label="Separation range"
                  value={range}
                  disabled={busy}
                  onChange={(e) => setRange(e.target.value as typeof range)}
                >
                  <option value="source">Entire recording</option>
                  <option value="selection" disabled={!p.selection}>
                    Current selection
                  </option>
                </select>
              </label>
              <p className="caption">
                {p.source?.kind === 'native' ? p.source.name : 'Open a WAV from disk to begin.'} ·{' '}
                {formatTime(duration)}
                <br />
                Uses original audio. Exported stems keep the source sample rate and channel count.
              </p>
              {mode === 'sound' && (
                <>
                  <label className="field-label">
                    Sounds to isolate (one per line, up to 8)
                    <textarea
                      aria-label="Sound description"
                      rows={mode === 'sound' ? 3 : 1}
                      maxLength={mode === 'sound' ? 1600 : 200}
                      value={prompt}
                      disabled={busy}
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </label>
                  {!!suggestions.length && (
                    <div
                      className="separation-presets"
                      aria-label="Suggestions from audio analysis"
                    >
                      {suggestions.map((item) => (
                        <button
                          key={item.classId}
                          disabled={busy}
                          onClick={() => setPrompt(item.label)}
                        >
                          {item.label} · {Math.round(item.confidence * 100)}%
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {mode === 'transients' && (
                <label className="field-label">
                  Transient sensitivity · {Math.round(sensitivity * 100)}%
                  <input
                    aria-label="Transient sensitivity"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={sensitivity}
                    disabled={busy}
                    onChange={(e) => setSensitivity(+e.target.value)}
                  />
                </label>
              )}
              {mode === 'music' && (
                <p className="caption">
                  Guitar and piano isolation is experimental. The residual track retains material
                  the model did not assign.
                </p>
              )}
              {(mode === 'auto' || mode === 'identify') && (
                <label className="field-label">
                  Minimum detection score · {Math.round(confidence * 100)}%
                  <input
                    aria-label="Minimum detection score"
                    type="range"
                    min="0.1"
                    max="0.95"
                    step=".05"
                    value={confidence}
                    disabled={busy}
                    onChange={(e) => setConfidence(+e.target.value)}
                  />
                  <span className="caption">
                    Higher scores give fewer, stronger suggestions. Scores are model estimates, not
                    guarantees.
                  </span>
                </label>
              )}
              {(mode === 'auto' || mode === 'music' || mode === 'sound') && (
                <label className="field-label">
                  Spectral cleanup · {cleanup === 0 ? 'Off' : `${Math.round(cleanup * 100)}%`}
                  <input
                    aria-label="Spectral cleanup"
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={cleanup}
                    disabled={busy}
                    onChange={(e) => setCleanup(+e.target.value)}
                  />
                  <span className="caption">
                    Separate shared frequencies and reduce bleed. Unassigned audio stays in the
                    residual track.
                  </span>
                </label>
              )}
              {mode === 'identify' && (
                <p className="caption">
                  Analyses 527 learned sound classes. No example sounds are preselected. Extract a
                  detected sound directly from its result.
                </p>
              )}
              {mode === 'transients' && (
                <p className="caption">
                  Extracts abrupt spectral changes relative to their background. The detector does
                  not infer which object made a click.
                </p>
              )}
              {duration > 600 && (
                <p className="error-banner" role="alert">
                  Select a section of at most 10 minutes.
                </p>
              )}
              {!ready && status && (
                <div className="separation-install">
                  <strong>
                    {status.pythonAvailable
                      ? 'Install this local AI pack'
                      : 'Python 3.11+ is required'}
                  </strong>
                  <p>
                    {status.pythonAvailable
                      ? `One-time download: ${Math.ceil(assets.filter((asset) => (mode === 'auto' || asset.pack === mode) && !status[asset.pack as 'music' | 'sound' | 'identify']).reduce((sum, asset) => sum + asset.size, 0) / 1048576)} MB of models${status.runtimeReady ? '' : ', plus the inference runtime'}. Your recording stays on this device.`
                      : 'Install Python, then reopen this workspace. Each AI pack runs locally after setup.'}
                  </p>
                  <button
                    className="quiet-button full-width"
                    disabled={busy || !status.pythonAvailable}
                    onClick={() => void run(true)}
                  >
                    <Download size={14} />
                    Install {mode === 'transients' ? 'local runtime' : 'AI pack'}
                  </button>
                </div>
              )}
              <button
                className="apply-button"
                disabled={busy || !ready || !canRun || (mode === 'sound' && !prompt.trim())}
                onClick={() => void run()}
              >
                {busy ? <LoaderCircle size={16} className="spinning" /> : <Sparkles size={16} />}{' '}
                {mode === 'auto'
                  ? 'Analyse and separate'
                  : mode === 'music'
                    ? 'Split into tracks'
                    : mode === 'sound'
                      ? 'Isolate sound'
                      : mode === 'identify'
                        ? 'Find sounds'
                        : 'Find tiny clicks'}
              </button>
              {busy && (
                <button
                  className="quiet-button full-width"
                  onClick={() => {
                    setMessage('Cancelling…');
                    void invoke('ai_cancel').catch((e) => setError(String(e)));
                  }}
                >
                  Cancel processing
                </button>
              )}
            </>
          )}
          {message && (
            <div className="separation-progress" role="status">
              {message}
              {busy && progress !== null && (
                <progress aria-label="Separation progress" max={1} value={progress} />
              )}
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </section>
        <section className="separation-results" aria-label="Separated tracks and sound events">
          <div className="separation-results-heading">
            <h3>
              {result?.tracks.length
                ? 'Separated tracks'
                : result
                  ? 'Sound regions'
                  : 'Analysis and tracks'}
            </h3>
            {!!result?.tracks.length && (
              <button className="quiet-button" disabled={busy} onClick={() => void exportAll()}>
                <Download size={14} />
                Export all WAVs
              </button>
            )}
          </div>
          {results.length > 1 && (
            <select
              aria-label="Separation results"
              value={result?.id}
              disabled={busy}
              onChange={(e) => {
                void preview.current?.stop();
                setPreviewId(null);
                setResult(results.find((r) => r.id === e.target.value) || null);
              }}
            >
              {results.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {results.length - i}. {modes.find((m) => m.id === r.mode)?.name} · {r.sourceName}
                </option>
              ))}
            </select>
          )}
          {result ? (
            <>
              <div className="separation-result-source">
                <span>
                  {result.sourceName} · {formatTime(result.offsetSeconds)}–
                  {formatTime(result.offsetSeconds + result.duration)}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void openTrack(result.sourcePath)}
                >
                  Open original
                </button>
              </div>
              {!!result.tracks.length && !!result.cleanup && (
                <p className="caption">
                  Spectral cleanup applied at {Math.round(result.cleanup * 100)}%. The residual
                  preserves unassigned and removed material.
                </p>
              )}
              {result.tracks.map((track) => (
                <div
                  className={`separated-track ${previewId === track.id ? 'auditioning' : ''}`}
                  key={track.id}
                >
                  <div className="separated-track-icon">
                    <AudioLines size={22} />
                  </div>
                  <div className="separated-track-name">
                    <strong>{track.name}</strong>
                    <span>
                      {track.channels === 1 ? 'Mono' : 'Stereo'} ·{' '}
                      {track.sampleRate.toLocaleString()} Hz ·{' '}
                      {formatTime(track.frames / track.sampleRate)}
                      {previewId === track.id ? ` · ${formatTime(previewTime)}` : ''}
                    </span>
                  </div>
                  <button
                    className="track-preview"
                    aria-label={`${previewId === track.id ? 'Stop preview' : 'Preview'} ${track.name}`}
                    disabled={busy}
                    onClick={() => void audition(track)}
                  >
                    {previewId === track.id ? <Square size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    className="quiet-button"
                    disabled={busy}
                    onClick={() => void openTrack(track.path)}
                  >
                    Open in editor
                  </button>
                </div>
              ))}
              {!!result.events.length && (
                <>
                  {!!result.sources?.length && (
                    <div className="detected-sources" aria-label="Detected sources">
                      <h4>Detected in this recording</h4>
                      {result.sources.map((source) => (
                        <div className="detected-source" key={source.classId}>
                          <span>
                            <strong>{source.label}</strong>
                            <small>
                              Score {Math.round(source.confidence * 100)}% ·{' '}
                              {formatTime(source.seconds)} detected
                            </small>
                          </span>
                          <button
                            className="quiet-button"
                            aria-label={`Extract ${source.label}`}
                            disabled={busy || result.sourceHash !== p.fingerprint}
                            onClick={() =>
                              void run(false, {
                                mode: 'sound',
                                prompts: [source.label],
                                start: Math.round(result.offsetSeconds * (p.info?.sampleRate || 0)),
                                end: Math.round(
                                  (result.offsetSeconds + result.duration) *
                                    (p.info?.sampleRate || 0),
                                ),
                              })
                            }
                          >
                            Extract track
                          </button>
                        </div>
                      ))}
                      {result.mode === 'identify' && (
                        <button
                          className="apply-button"
                          disabled={busy || result.sourceHash !== p.fingerprint}
                          onClick={() =>
                            void run(false, {
                              mode: 'auto',
                              start: Math.round(result.offsetSeconds * (p.info?.sampleRate || 0)),
                              end: Math.round(
                                (result.offsetSeconds + result.duration) *
                                  (p.info?.sampleRate || 0),
                              ),
                            })
                          }
                        >
                          Separate detected sounds
                        </button>
                      )}
                    </div>
                  )}
                  <p className="caption">
                    Extract creates audio with a shaped spectral mask. Inspect region only moves the
                    editor selection.{' '}
                    {result.sourceHash !== p.fingerprint &&
                      'Open the original recording to extract or inspect its events.'}
                  </p>
                  <div className="sound-event-list">
                    {result.events.slice(0, 100).map((event, index) => (
                      <div className="sound-event" key={index}>
                        <span className="sound-event-time">
                          {formatTime(event.start + result.offsetSeconds)}–
                          {formatTime(event.end + result.offsetSeconds)}
                        </span>
                        <span>
                          <strong>{event.label}</strong>
                          <small>
                            {event.confidence !== undefined
                              ? `Detector score ${Math.round(event.confidence * 100)}%`
                              : 'Brief spectral change · identity unconfirmed'}
                          </small>
                        </span>
                        {event.kind === 'sound' && (
                          <button
                            className="quiet-button"
                            aria-label={`Extract event ${event.label}`}
                            disabled={busy || result.sourceHash !== p.fingerprint}
                            onClick={() =>
                              void run(false, {
                                mode: 'sound',
                                prompts: [event.label],
                                start: Math.round(result.offsetSeconds * (p.info?.sampleRate || 0)),
                                end: Math.round(
                                  (result.offsetSeconds + result.duration) *
                                    (p.info?.sampleRate || 0),
                                ),
                              })
                            }
                          >
                            Extract
                          </button>
                        )}
                        <button
                          className="text-button"
                          disabled={busy || result.sourceHash !== p.fingerprint}
                          onClick={() => selectEvent(event)}
                        >
                          Inspect region
                        </button>
                      </div>
                    ))}
                  </div>
                  {result.events.length > 100 && (
                    <p className="caption">
                      Showing the first 100 of {result.events.length} detections. All detections are
                      saved with exported tracks.
                    </p>
                  )}
                </>
              )}
              {!result.tracks.length && !result.events.length && (
                <p className="separation-note">
                  No sounds met the analysis threshold. Try a smaller selection or lower the minimum
                  detection score.
                </p>
              )}
            </>
          ) : (
            <div className="separation-empty">
              <AudioLines size={48} strokeWidth={1} />
              <h3>Start with the recording.</h3>
              <p>
                Choose Analyse and separate to detect sources and create cleaned tracks. Suggestions
                appear after the audio has been analysed.
              </p>
              <span>Original audio stays untouched.</span>
            </div>
          )}
        </section>
      </div>
      <p className="separation-footer">
        AI separation is an estimate. Audition every track; overlapping sources can bleed through,
        and an absent sound may still produce artifacts. Finished tracks remain in local AI storage;
        export WAVs to keep a portable copy.
      </p>
    </dialog>
  );
}
