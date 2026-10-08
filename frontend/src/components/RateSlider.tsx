import './RateSlider.css';

export const RATE_MIN = 0.5;
export const RATE_MAX = 1.2;
const MARKS = [0.5, 0.65, 0.85, 1, 1.2];
// Distancia a la que una marca "atrae" el valor
const SNAP = 0.025;

function snap(v: number) {
  for (const m of MARKS) if (Math.abs(v - m) <= SNAP) return m;
  return v;
}

interface Props {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
}

/** Slider de velocidad (slowed) con marcas ligeramente magnéticas. */
export default function RateSlider({ value, onChange, disabled, className }: Props) {
  const pct = (v: number) => ((v - RATE_MIN) / (RATE_MAX - RATE_MIN)) * 100;
  return (
    <div className="rate-slider">
      <input
        className={className}
        type="range"
        min={RATE_MIN}
        max={RATE_MAX}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={e => onChange(snap(Number(e.target.value)))}
      />
      <div className="rate-slider-marks" aria-hidden>
        {MARKS.map(m => (
          <button
            key={m}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className={`rate-slider-mark${Math.abs(value - m) < 0.005 ? ' active' : ''}`}
            style={{ left: `${pct(m)}%` }}
            onClick={() => onChange(m)}
          >
            <span className="rate-slider-tick" />
            {Math.round(m * 100)}%
          </button>
        ))}
      </div>
    </div>
  );
}
