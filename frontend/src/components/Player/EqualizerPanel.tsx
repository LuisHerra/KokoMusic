import { usePlayerStore } from '../../store/playerStore';

// Presets: [60Hz, 230Hz, 910Hz, 4kHz, 14kHz]
const EQ_PRESETS: Record<string, number[]> = {
  'Plano':       [0,  0,  0,  0,  0],
  'Bass Boost':  [8,  5,  0,  0,  0],
  'Vocal':       [-2, 0,  6,  4,  2],
  'Electronic':  [6,  3,  0,  3,  5],
  'Acústico':    [3,  2,  0, -1,  2],
  'Rock':        [4,  2,  0,  3,  4],
  'Jazz':        [2,  1,  3,  2,  1],
  'Classical':   [0,  0,  0,  2,  4],
};

const BAND_LABELS = ['Sub', 'Bass', 'Mid', 'Pres', 'Air'];
const BAND_FREQS  = ['60Hz', '230Hz', '910Hz', '4kHz', '14kHz'];

export default function EqualizerPanel({ onClose }: { onClose: () => void }) {
  const { eqBands, setEqBand, setEqPreset } = usePlayerStore();

  const activePreset = Object.entries(EQ_PRESETS).find(([, v]) =>
    v.every((db, i) => db === eqBands[i])
  )?.[0] ?? null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '90px',
        right: '20px',
        width: '320px',
        background: '#161616',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px',
        padding: '20px',
        zIndex: 9999,
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>Ecualizador</div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginTop: '2px' }}>5 bandas · Web Audio</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
        {Object.keys(EQ_PRESETS).map((name) => (
          <button
            key={name}
            onClick={() => setEqPreset(EQ_PRESETS[name])}
            style={{
              padding: '5px 10px',
              borderRadius: '20px',
              border: 'none',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              background: activePreset === name ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
              color: activePreset === name ? '#000' : 'rgba(255,255,255,0.7)',
              transition: 'all 0.15s ease',
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Sliders */}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'flex-end', height: '140px' }}>
        {eqBands.map((db, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              height: '100%',
              justifyContent: 'space-between',
            }}
          >
            {/* dB value */}
            <div style={{
              fontSize: '10px',
              fontWeight: 700,
              color: db > 0 ? 'var(--accent)' : db < 0 ? '#f87171' : 'rgba(255,255,255,0.4)',
              minHeight: '14px',
              textAlign: 'center',
            }}>
              {db > 0 ? `+${db}` : db}
            </div>

            {/* Vertical range slider */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <input
                type="range"
                min="-12"
                max="12"
                step="1"
                value={db}
                onChange={(e) => setEqBand(i, Number(e.target.value))}
                style={{
                  writingMode: 'vertical-lr' as any,
                  WebkitAppearance: 'slider-vertical' as any,
                  direction: 'rtl' as any,
                  width: '28px',
                  height: '80px',
                  cursor: 'pointer',
                  accentColor: db > 0 ? 'var(--accent)' : db < 0 ? '#f87171' : 'rgba(255,255,255,0.3)',
                }}
              />
            </div>

            {/* Labels */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>
                {BAND_LABELS[i]}
              </div>
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.3)', marginTop: '2px' }}>
                {BAND_FREQS[i]}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 0dB line indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: '10px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: '10px',
      }}>
        <button
          onClick={() => setEqPreset([0, 0, 0, 0, 0])}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: 'none',
            borderRadius: '8px',
            padding: '6px 14px',
            color: 'rgba(255,255,255,0.5)',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Resetear
        </button>
      </div>
    </div>
  );
}
