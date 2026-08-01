import { useState, useEffect } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { getActiveAudio, getAudioElements } from '../../hooks/useAudioPlayer';
import { getApiUrl } from '../../lib/backendResolver';
import { getClientLogs, clearClientLogs, logToServer, type LogEntry } from '../../lib/logger';
import { isTrackOffline } from '../../lib/offlineAudio';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function DebugStreamModal({ isOpen, onClose }: Props) {
  const { currentTrack, isLoading, error, setEmbedMode, setError } = usePlayerStore();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [statusData, setStatusData] = useState<any>(null);
  const [isOffline, setIsOffline] = useState<boolean | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [testingStream, setTestingStream] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const activeAudio = getActiveAudio();
  const { activeIdx } = getAudioElements();

  useEffect(() => {
    if (!isOpen) return;

    setLogs(getClientLogs());
    getApiUrl().then(setApiBaseUrl);

    if (currentTrack?.id) {
      isTrackOffline(currentTrack.id).then(setIsOffline);
      fetchStatus();
    }

    const interval = setInterval(() => {
      setLogs(getClientLogs());
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, currentTrack?.id]);

  const fetchStatus = async () => {
    if (!currentTrack?.id) return;
    try {
      const apiBase = await getApiUrl();
      const res = await fetch(`${apiBase}/stream/${currentTrack.id}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatusData(data);
      } else {
        setStatusData({ error: `HTTP ${res.status} - ${res.statusText}` });
      }
    } catch (err: any) {
      setStatusData({ error: err.message || 'Error de conexión' });
    }
  };

  const handleTestStream = async () => {
    if (!currentTrack?.id) return;
    setTestingStream(true);
    setTestResult('Conectando...');
    try {
      const apiBase = await getApiUrl();
      const streamUrl = `${apiBase}/stream/${currentTrack.id}`;
      const startTime = Date.now();
      const res = await fetch(streamUrl, { method: 'HEAD' });
      const elapsed = Date.now() - startTime;
      
      const headersObj: Record<string, string> = {};
      res.headers.forEach((v, k) => { headersObj[k] = v; });

      const summary = `Status: ${res.status} ${res.statusText} (${elapsed}ms)
ContentType: ${res.headers.get('content-type') || 'N/A'}
ContentLength: ${res.headers.get('content-length') || 'N/A'}
URL final: ${res.url}`;

      setTestResult(summary);
      logToServer('INFO', `[DebugModal] Test stream result:\n${summary}`);
    } catch (err: any) {
      const errMsg = `Error de red: ${err.message || err}`;
      setTestResult(errMsg);
      logToServer('ERROR', `[DebugModal] Test stream failed`, err);
    } finally {
      setTestingStream(false);
    }
  };

  const handlePurgeCache = async () => {
    if (!currentTrack?.id) return;
    try {
      const apiBase = await getApiUrl();
      await fetch(`${apiBase}/stream/${currentTrack.id}/purge-cache`, { method: 'POST' });
      logToServer('INFO', `[DebugModal] Purga de caché solicitada para track: ${currentTrack.id}`);
      fetchStatus();
      setTestResult('Caché purgado correctamente. Vuelve a reproducir la canción.');
    } catch (err: any) {
      setTestResult(`Error al purgar caché: ${err.message}`);
    }
  };

  const handleForceEmbedMode = () => {
    if (!currentTrack?.id) return;
    const ytId = statusData?.youtubeId || currentTrack.id;
    setEmbedMode(true, ytId);
    setError(null);
    logToServer('INFO', `[DebugModal] Forzando YouTube Embed Mode para ID: ${ytId}`);
    onClose();
  };

  if (!isOpen) return null;

  const readyStateLabels = ['0 (HAVE_NOTHING)', '1 (HAVE_METADATA)', '2 (HAVE_CURRENT_DATA)', '3 (HAVE_FUTURE_DATA)', '4 (HAVE_ENOUGH_DATA)'];
  const networkStateLabels = ['0 (EMPTY)', '1 (IDLE)', '2 (LOADING)', '3 (NO_SOURCE)'];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(12px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '650px',
          maxHeight: '90vh',
          backgroundColor: '#121319',
          border: '1px solid var(--border-color, #2a2d3d)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
          overflow: 'hidden',
          color: '#e2e8f0',
          fontFamily: 'monospace',
          fontSize: '12px',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            background: 'linear-gradient(90deg, #1e1b4b, #0f172a)',
            borderBottom: '1px solid #2e354f',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🛠️</span>
            <strong style={{ fontSize: '14px', color: '#6366f1' }}>Diagnóstico de Stream & Red</strong>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#a0aec0',
              fontSize: '18px',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Current Track */}
          <div style={{ background: '#1a1c24', padding: '12px', borderRadius: '8px', border: '1px solid #262938' }}>
            <div style={{ color: '#818cf8', fontWeight: 'bold', marginBottom: '6px' }}>🎵 Track Actual</div>
            <div><strong>Título:</strong> {currentTrack?.title || 'Ninguno'}</div>
            <div><strong>Artista:</strong> {currentTrack?.artist || 'N/A'}</div>
            <div><strong>ID Track:</strong> {currentTrack?.id || 'N/A'}</div>
            <div><strong>IndexedDB (Offline):</strong> {isOffline === null ? 'Comprobando...' : isOffline ? '✅ Guardado' : '❌ No guardado'}</div>
            <div><strong>Estado Carga App:</strong> {isLoading ? '⏳ CUIDADO: Carga en progreso (isLoading=true)' : '✅ Listo (isLoading=false)'}</div>
            {error && <div style={{ color: '#f87171', marginTop: '4px' }}><strong>Error Actual:</strong> {error}</div>}
          </div>

          {/* Audio HTML5 Engine Status */}
          <div style={{ background: '#1a1c24', padding: '12px', borderRadius: '8px', border: '1px solid #262938' }}>
            <div style={{ color: '#34d399', fontWeight: 'bold', marginBottom: '6px' }}>🔊 Estado Motor de Audio HTML5</div>
            <div><strong>Audio Activo:</strong> audio{activeIdx + 1}</div>
            <div><strong>SRC actual:</strong> <span style={{ wordBreak: 'break-all', color: '#cbd5e1' }}>{activeAudio?.src || 'Vacio'}</span></div>
            <div><strong>Ready State:</strong> {activeAudio ? readyStateLabels[activeAudio.readyState] : 'N/A'}</div>
            <div><strong>Network State:</strong> {activeAudio ? networkStateLabels[activeAudio.networkState] : 'N/A'}</div>
            <div><strong>Pausado:</strong> {activeAudio?.paused ? 'Sí' : 'No'} | <strong>Tiempo:</strong> {activeAudio?.currentTime?.toFixed(1) || 0}s / {activeAudio?.duration?.toFixed(1) || 0}s</div>
            {activeAudio?.error && (
              <div style={{ color: '#f87171', marginTop: '4px' }}>
                <strong>Error de Audio Nativo:</strong> Código {activeAudio.error.code} - {activeAudio.error.message}
              </div>
            )}
          </div>

          {/* Backend Status */}
          <div style={{ background: '#1a1c24', padding: '12px', borderRadius: '8px', border: '1px solid #262938' }}>
            <div style={{ color: '#fbbf24', fontWeight: 'bold', marginBottom: '6px' }}>🌐 Estado Backend local / nube</div>
            <div><strong>Base URL API:</strong> {apiBaseUrl || 'Cargando...'}</div>
            <div>
              <strong>Diagnóstico Status:</strong>{' '}
              {statusData ? JSON.stringify(statusData, null, 2) : 'Cargando status...'}
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handleTestStream}
              disabled={testingStream}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              {testingStream ? 'Probando...' : '⚡ Probador Conexión Stream'}
            </button>
            <button
              onClick={handlePurgeCache}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              🧹 Purgar Caché
            </button>
            <button
              onClick={handleForceEmbedMode}
              style={{
                flex: 1,
                padding: '8px 12px',
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              🎥 Forzar Modo Embed YT
            </button>
          </div>

          {/* Test Result Display */}
          {testResult && (
            <pre
              style={{
                background: '#090a0f',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #334155',
                color: '#38bdf8',
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}
            >
              {testResult}
            </pre>
          )}

          {/* Live Logs */}
          <div style={{ background: '#090a0f', padding: '12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ color: '#a78bfa', fontWeight: 'bold' }}>📜 Consola de Registros Recientes</div>
              <button
                onClick={() => { clearClientLogs(); setLogs([]); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer' }}
              >
                Limpiar
              </button>
            </div>
            <div style={{ maxHeight: '250px', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {logs.length === 0 ? (
                <div style={{ color: '#64748b' }}>Sin registros guardados.</div>
              ) : (
                logs.slice().reverse().map((log, idx) => (
                  <div key={idx} style={{ wordBreak: 'break-all' }}>
                    <span style={{ color: '#64748b' }}>[{log.timestamp}]</span>{' '}
                    <span style={{ color: log.level === 'ERROR' ? '#f87171' : log.level === 'WARN' ? '#fbbf24' : '#38bdf8' }}>
                      [{log.level}]
                    </span>{' '}
                    <span>{log.message}</span>
                    {log.details && (
                      <div style={{ color: '#94a3b8', paddingLeft: '12px', fontSize: '11px' }}>
                        {typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details)}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
