import { useEffect, useState, useRef } from 'react';
export function NumberField({
  label,
  value,
  min,
  max,
  unit,
  digits = 3,
  disabled = false,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  digits?: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value.toFixed(digits));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value.toFixed(digits));
  }, [value, digits]);
  const commit = () => {
    focused.current = false;
    const parsed = Number(text);
    if (text.trim() && Number.isFinite(parsed)) {
      const n = Math.max(min, Math.min(max, parsed));
      setText(n.toFixed(digits));
      onCommit(n);
    } else setText(value.toFixed(digits));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="text"
          disabled={disabled}
          inputMode="decimal"
          value={text}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setText(value.toFixed(digits));
              e.currentTarget.blur();
            }
          }}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
}
