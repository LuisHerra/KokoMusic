/**
 * "Mis vídeos": vídeos musicales guardados en el dispositivo (Películas/
 * KokoMusic) desde la APK. No se guardan en el navegador ni en el servidor.
 */
import { useEffect, useState } from 'react';
import { canSaveVideosOnDevice, deleteLocalVideo, listLocalVideos, localVideoUrl, type LocalVideo } from '../lib/androidApp';
import { usePlayerStore } from '../store/playerStore';
import { IconPlay, IconVideo } from '../components/SocialIcons';

const fmtSize = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return ms > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
};

export default function LocalVideos() {
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [playing, setPlaying] = useState<LocalVideo | null>(null);

  useEffect(() => { setVideos(listLocalVideos()); }, []);

  if (!canSaveVideosOnDevice()) {
    return (
      <div className="capsules-page">
        <h1 className="capsule-h1"><IconVideo size={28} /> Mis vídeos</h1>
        <p className="capsule-sub">Los vídeos se guardan solo en el móvil: descárgalos desde la app de Android con “Descargar vídeo” en el menú de tres puntos de una canción.</p>
      </div>
    );
  }

  const open = (v: LocalVideo) => {
    // Que no suenen a la vez la canción y el vídeo
    if (usePlayerStore.getState().isPlaying) usePlayerStore.getState().setIsPlaying(false);
    setPlaying(v);
  };

  return (
    <div className="capsules-page">
      <h1 className="capsule-h1"><IconVideo size={28} /> Mis vídeos</h1>
      <p className="capsule-sub" style={{ marginBottom: 16 }}>Guardados en este dispositivo (Películas/KokoMusic). Funcionan sin conexión.</p>

      {playing && (
        <div className="local-video-player">
          <video key={playing.id} src={localVideoUrl(playing.id)} controls autoPlay playsInline style={{ width: '100%', borderRadius: 14, background: '#000' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playing.name}</strong>
            <button className="capsule-btn capsule-btn-ghost" onClick={() => setPlaying(null)}>Cerrar</button>
          </div>
        </div>
      )}

      {videos.length === 0 ? (
        <p className="capsule-sub">Aún no has guardado ningún vídeo. Toca los tres puntos de una canción y elige “Descargar vídeo”.</p>
      ) : (
        <ul className="capsule-results" style={{ marginTop: 16 }}>
          {videos.map((v) => (
            <li key={v.id} onClick={() => open(v)}>
              <span className="capsule-cover-ph" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><IconPlay size={16} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="capsule-track-title">{v.name}</div>
                <div className="capsule-sub">{[fmtDur(v.durationMs), fmtSize(v.size)].filter(Boolean).join(' · ')}</div>
              </div>
              <button
                className="capsule-btn capsule-btn-ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!confirm(`¿Borrar "${v.name}" del dispositivo?`)) return;
                  deleteLocalVideo(v.id);
                  if (playing?.id === v.id) setPlaying(null);
                  setVideos(listLocalVideos());
                }}
              >Borrar</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
