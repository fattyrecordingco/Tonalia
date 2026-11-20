import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, LoaderCircle, Piano, Scan, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { AudioEngine } from '../engine/client';
import { identifyNote, noteHz, noteName, type NoteConversion } from '../engine/notes';
import {
  formatTime,
  maskBounds,
  type Layer,
  type Mask,
  type Point,
  type View,
  type WavInfo,
} from '../types';

interface Props {
  engine: AudioEngine;
  info: WavInfo | null;
  name: string;
  layers: Layer[];
  view: View;
  selection: Mask | null;
  loading: boolean;
  conversion: NoteConversion | null;
  onConversion: (value: NoteConversion | null) => void;
  show: boolean;
  onShow: (value: boolean) => void;
  cursor: { p: Point; ch: number } | null;
  position: number;
  onView: (view: View) => void;
}
export function NoteControls(p: Props) {
  const [range, setRange] = useState('all');
  const [signal, setSignal] = useState<'original' | 'result'>('result');
  const [channel, setChannel] = useState('all');
  const [threshold, setThreshold] = useState(-48);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0),
    [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [settingsOpen]);
  const generation = useRef(0);
  const { min, max, tracks } = useMemo(() => {
    const notes = p.conversion?.notes ?? [];
    return {
      min: notes.reduce((a, n) => Math.min(a, n.midi), 127),
      max: notes.reduce((a, n) => Math.max(a, n.midi), 0),
      tracks: Array.from({ length: p.info?.channels ?? 0 }, (_, ch) =>
        notes.filter((n) => n.channel === ch),
      ),
    };
  }, [p.conversion, p.info]);
  useEffect(() => {
    generation.current++;
    p.engine.cancelNotes();
    p.onConversion(null);
    setBusy(false);
    setStatus('');
    setError('');
    return () => {
      generation.current++;
      p.engine.cancelNotes();
    };
  }, [p.info, p.layers, p.engine, p.onConversion, range, signal, channel, threshold]);
  useEffect(() => {
    setChannel('all');
  }, [p.info]);
  useEffect(() => {
    p.engine.onNoteProgress = setProgress;
    return () => {
      p.engine.onNoteProgress = () => {};
    };
  }, [p.engine]);
  const convert = async () => {
    if (!p.info) return;
    const own = ++generation.current;
    p.onConversion(null);
    setBusy(true);
    setProgress(0);
    setError('');
    setStatus('');
    const bounds = range === 'selection' && p.selection ? maskBounds(p.selection) : p.view;
    try {
      const result = await p.engine.convertNotes(
        {
          start: range === 'all' ? 0 : bounds.start,
          end: range === 'all' ? p.info.frames : bounds.end,
          channel: channel === 'all' ? null : +channel,
          signal,
          thresholdDb: threshold,
        },
        p.layers,
      );
      if (own !== generation.current || !result) return;
      p.onConversion(result);
      p.onShow(true);
      setStatus(
        result.notes.length
          ? `${result.notes.length} notes detected`
          : 'No stable notes found. Try a lower gate or an isolated melody.',
      );
    } catch (e) {
      if (own === generation.current) setError(String(e));
    } finally {
      if (own === generation.current) setBusy(false);
    }
  };
  const save = async () => {
    if (!p.conversion) return;
    setSaving(true);
    setError('');
    try {
      if (await p.engine.exportMidi(p.name, p.conversion)) setStatus('MIDI exported');
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };
  if (!p.info) return null;
  const pitch = p.cursor ? identifyNote(p.cursor.p.hz) : null;
  const time = p.cursor?.p.sample ?? p.position;
  const active = tracks.flatMap((track, ch) => {
    if (p.cursor && ch !== p.cursor.ch) return [];
    let low = 0,
      high = track.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (track[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    const note = track[low - 1];
    return note && note.end > time ? [note] : [];
  })[0];
  return (
    <div
      className="note-workbench"
      aria-label="Notes and MIDI"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && settingsOpen) {
          e.stopPropagation();
          setSettingsOpen(false);
          root.current
            ?.querySelector<HTMLButtonElement>('[aria-label="Conversion settings"]')
            ?.focus();
        }
      }}
    >
      <div className="note-actions">
        <span className="note-heading">
          <span className="note-icon">
            <Piano size={17} />
          </span>{' '}
          Notes & MIDI
        </span>
        <label className="note-toggle">
          <input type="checkbox" checked={p.show} onChange={(e) => p.onShow(e.target.checked)} />{' '}
          Note ruler
        </label>
        <select
          aria-label="Note conversion range"
          value={range}
          disabled={busy}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="all">Whole recording</option>
          <option value="view">Visible time range</option>
          <option value="selection" disabled={!p.selection}>
            Selected time range
          </option>
        </select>
        <button
          className={`note-settings-toggle ${settingsOpen ? 'active' : ''}`}
          aria-label="Conversion settings"
          title="Conversion settings"
          aria-expanded={settingsOpen}
          aria-controls="note-conversion-settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <SlidersHorizontal size={15} />
        </button>
        {busy ? (
          <button
            className="note-convert"
            onClick={() => {
              generation.current++;
              p.engine.cancelNotes();
              setBusy(false);
              setStatus('Conversion cancelled');
            }}
          >
            <X size={13} /> Cancel {Math.round(progress * 100)}%
          </button>
        ) : (
          <button
            className="note-convert"
            disabled={p.loading || saving || (range === 'selection' && !p.selection)}
            onClick={() => void convert()}
          >
            <Sparkles size={14} />
            {p.conversion ? 'Convert again' : 'Convert to notes'}
          </button>
        )}
        <button
          className="note-export"
          disabled={busy || saving || p.loading || !p.conversion?.notes.length}
          onClick={() => void save()}
        >
          {saving ? <LoaderCircle size={13} className="spinning" /> : <Download size={13} />} Export
          MIDI
        </button>
      </div>
      <div className="note-settings" id="note-conversion-settings" hidden={!settingsOpen}>
        <div className="note-settings-heading">
          <SlidersHorizontal size={14} />
          <strong>Conversion settings</strong>
          <button aria-label="Close conversion settings" onClick={() => setSettingsOpen(false)}>
            <X size={14} />
          </button>
        </div>
        <label>
          Signal{' '}
          <select
            aria-label="Note conversion signal"
            value={signal}
            disabled={busy}
            onChange={(e) => setSignal(e.target.value as 'original' | 'result')}
          >
            <option value="result">Result</option>
            <option value="original">Original</option>
          </select>
        </label>
        <label>
          Channel{' '}
          <select
            aria-label="Note conversion channel"
            value={channel}
            disabled={busy}
            onChange={(e) => setChannel(e.target.value)}
          >
            <option value="all">{p.info.channels === 1 ? 'Mono' : 'Both, separately'}</option>
            {p.info.channels === 2 && (
              <>
                <option value="0">Left</option>
                <option value="1">Right</option>
              </>
            )}
          </select>
        </label>
        <label>
          Gate{' '}
          <select
            aria-label="Note detection gate"
            value={threshold}
            disabled={busy}
            onChange={(e) => setThreshold(+e.target.value)}
          >
            {[-60, -48, -36, -24].map((db) => (
              <option key={db} value={db}>
                {db} dBFS
              </option>
            ))}
          </select>
        </label>
        <span
          className="note-method"
          title="One dominant pitch per channel; 60 ms minimum note length. Chords, percussion and dense mixes may produce incorrect notes."
        >
          C1–C7 · A4 = 440 Hz · One melody per channel
        </span>
        <p className="note-caveat">
          Chords and dense mixes may need correction. MIDI preserves measured timing and starts the
          converted range at 0.
        </p>
      </div>
      <div className="note-readout">
        <span className="pitch-readout" aria-label="Pitch at cursor">
          {pitch ? (
            <>
              <strong>{pitch.name}</strong>
              <span>MIDI {pitch.midi}</span>
              <span>
                {pitch.cents > 0 ? '+' : ''}
                {pitch.cents} ct
              </span>
              <span>{p.cursor!.p.hz.toFixed(1)} Hz</span>
            </>
          ) : (
            <>
              <span className="pitch-placeholder">♪</span>
              <span>Point at a frequency to read its note</span>
            </>
          )}
        </span>
        <span role="status">{busy ? `Converting ${Math.round(progress * 100)}%` : status}</span>
        {!!p.conversion?.notes.length && (
          <button
            title="Fit the time and pitch range of the converted notes"
            aria-label="Fit detected notes"
            onClick={() =>
              p.onView({
                start: p.conversion!.start,
                end: p.conversion!.end,
                low: Math.max(20, noteHz(min - 3)),
                high: Math.min(p.info!.sampleRate / 2, noteHz(max + 3)),
                log: true,
              })
            }
          >
            <Scan size={13} /> {noteName(min)}–{noteName(max)}
          </button>
        )}
      </div>
      {!!p.conversion?.notes.length && (
        <div className="detected-note-detail" aria-label="Detected note details">
          {active ? (
            <>
              <strong>{noteName(active.midi)}</strong> MIDI {active.midi}
              <span>
                {formatTime(active.start / p.info.sampleRate)}–
                {formatTime(active.end / p.info.sampleRate)}
              </span>
              <span>{((active.end - active.start) / p.info.sampleRate).toFixed(3)} s</span>
              <span>{Math.round(active.confidence * 100)}% confidence</span>
              <span>Velocity {active.velocity}</span>
            </>
          ) : (
            <span>Move over a note or play the audio to inspect its timing and confidence.</span>
          )}
        </div>
      )}
      {p.conversion && (
        <p className="note-conversion-scope">
          {p.conversion.signal === 'result' ? 'Result' : 'Original'} ·{' '}
          {formatTime(p.conversion.start / p.info.sampleRate)}–
          {formatTime(p.conversion.end / p.info.sampleRate)} <span>Melody estimate</span>
        </p>
      )}
      {error && (
        <p className="note-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
