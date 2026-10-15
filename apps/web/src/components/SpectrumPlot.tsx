import { useMemo } from 'react';
import type { Analysis } from '../types';
import { formatTime } from '../types';
export function SpectrumPlot({
  analysis,
  position,
}: {
  analysis: Analysis | null;
  position: number;
}) {
  const trace = useMemo(() => {
    if (!analysis) return '';
    const a = analysis,
      col = Math.max(0, Math.min(a.columns - 1, Math.round((position - a.start) / a.hop)));
    const out = [];
    for (let x = 0; x <= 240; x++) {
      const hz = 20 * (a.sampleRate / 40) ** (x / 240);
      const k = Math.min(a.bins - 1, Math.round((hz * a.fftSize) / a.sampleRate));
      let power = 0;
      for (let ch = 0; ch < a.channels; ch++)
        power += 10 ** (a.levels[(ch * a.columns + col) * a.bins + k] / 10);
      const d = 10 * Math.log10(Math.max(1e-24, power / a.channels));
      out.push(`${x ? 'L' : 'M'}${x},${Math.max(0, Math.min(110, (-d / 120) * 110))}`);
    }
    return out.join(' ');
  }, [analysis, position]);
  return (
    <div className="spectrum-plot">
      <div className="section-heading">
        <h3>Frame spectrum</h3>
        <span>
          {analysis
            ? formatTime(
                Math.max(
                  0,
                  analysis.start +
                    Math.round((position - analysis.start) / analysis.hop) * analysis.hop,
                ) / analysis.sampleRate,
              )
            : '—'}
        </span>
      </div>
      <svg
        viewBox="0 0 240 130"
        role="img"
        aria-label="Peak-amplitude spectrum of the nearest analyzed frame"
      >
        <defs>
          <linearGradient id="spectrum-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a0d6ca" stopOpacity=".18" />
            <stop offset="1" stopColor="#a0d6ca" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 30, 60, 90].map((y) => (
          <line key={y} x1={0} x2={240} y1={y} y2={y} stroke="#39414d" strokeWidth=".5" />
        ))}
        {trace && (
          <>
            <path d={trace + ' L240 110L0 110Z'} fill="url(#spectrum-fill)" />
            <path d={trace} fill="none" stroke="#a0d6ca" strokeWidth="1.2" />
          </>
        )}
        <text x="0" y="128">
          20 Hz
        </text>
        <text x="108" y="128">
          1k
        </text>
        <text x="215" y="128">
          {analysis ? Math.round(analysis.sampleRate / 2000) : 24}k
        </text>
      </svg>
      <p className="caption">Hann-windowed peak amplitude. Stereo traces use mean power.</p>
    </div>
  );
}
