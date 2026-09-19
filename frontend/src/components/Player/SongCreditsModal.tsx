import { useState } from 'react';
import { type Track, getTrackRadio } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';
import { getAdaptiveQualityLabel } from '../../lib/adaptiveBitrate';

interface SongCreditsModalProps {
  track: Track;
  onClose: () => void;
}

export default function SongCreditsModal({ track, onClose }: SongCreditsModalProps) {
  const { setQueue } = usePlayerStore();
  const [loadingRadio, setLoadingRadio] = useState(false);
  const [radioMsg, setRadioMsg] = useState('');

  const handleStartRadio = async () => {
    setLoadingRadio(true);
    setRadioMsg('Sintonizando radio...');
    try {
      const res = await getTrackRadio(track.id);
      if (res.tracks && res.tracks.length > 0) {
        setQueue(res.tracks, 0);
        setRadioMsg(`¡Radio iniciada! (${res.tracks.length} canciones sintonizadas)`);
        setTimeout(() => {
          onClose();
        }, 1200);
      } else {
        setRadioMsg('No se encontraron suficientes temas para la radio.');
      }
    } catch (err) {
      console.error('Error iniciando radio:', err);
      setRadioMsg('Error al sintonizar la radio.');
    } finally {
      setLoadingRadio(false);
    }
  };

  const savedQuality = localStorage.getItem('koko_audio_quality');
  const qualityLabel = savedQuality === '96'
    ? '96 kbps (Ahorro)'
    : savedQuality === '160'
    ? '160 kbps (Alta)'
    : savedQuality === '320'
    ? '320 kbps (Alta fidelidad)'
    : getAdaptiveQualityLabel();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#181818',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 20,
          padding: 24,
          maxWidth: 460,
          width: '100%',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
          color: '#fff',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              background: 'rgba(29, 185, 84, 0.15)',
              color: '#1DB954',
              padding: '4px 10px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              border: '1px solid rgba(29, 185, 84, 0.3)',
            }}>
              Créditos & Metadatos
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#bbb',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Track Main Info */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, alignItems: 'center' }}>
          <img
            src={track.cover || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=300&auto=format&fit=crop'}
            alt={track.title}
            style={{ width: 68, height: 68, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.title}
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              {track.artist}
            </p>
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 20,
          background: 'rgba(255,255,255,0.03)',
          padding: 14,
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Álbum</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.album || 'Single / Desconocido'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Género Principal</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>
              {track.genre || 'Música General'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Calidad de Audio</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1DB954', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1DB954' }} />
              {qualityLabel}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Resolución</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>
              Multi-Source CDN
            </div>
          </div>
        </div>

        {/* Actions: Start Radio Button */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={handleStartRadio}
            disabled={loadingRadio}
            style={{
              background: 'linear-gradient(135deg, #1DB954 0%, #179b45 100%)',
              color: '#000',
              border: 'none',
              borderRadius: 14,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 700,
              cursor: loadingRadio ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              boxShadow: '0 4px 16px rgba(29,185,84,0.35)',
              transition: 'all 0.2s',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
            </svg>
            {loadingRadio ? 'Sintonizando Radio...' : 'Iniciar Radio de esta Canción'}
          </button>

          {radioMsg && (
            <div style={{
              textAlign: 'center',
              fontSize: 12,
              color: radioMsg.includes('¡') ? '#1DB954' : '#ffc107',
              marginTop: 4,
              fontWeight: 600,
            }}>
              {radioMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
