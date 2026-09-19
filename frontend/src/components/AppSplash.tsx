/**
 * AppSplash.tsx
 * Pantalla de espera mientras el backend arranca.
 * Hace polling a /api/health cada 2s. Desaparece en cuanto responde.
 */
import { useState, useEffect } from 'react';
import { getApiUrl } from '../lib/backendResolver';

interface Props {
  onReady: () => void;
}

export default function AppSplash({ onReady }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [dots, setDots] = useState('');

  // Fallback de seguridad: Si tras 4s el backend no responde o se retrasa, fuerza la entrada al Frontend
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      console.warn('[AppSplash] Timeout de seguridad (4s) alcanzado — Mostrando AppShell');
      onReady();
    }, 4000);
    return () => clearTimeout(safetyTimer);
  }, [onReady]);

  // Animación de puntos
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(t);
  }, []);

  // Polling al backend
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const apiUrl = await getApiUrl();
        const res = await fetch(`${apiUrl}/health`, {
          signal: AbortSignal.timeout(3000),
          cache: 'no-store',
        });
        if (res.ok && !cancelled) {
          onReady();
          return;
        }
      } catch {
        // backend aún no está listo
      }
      if (!cancelled) {
        setTimeout(() => setAttempt(a => a + 1), 1500);
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [attempt, onReady]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: '#0a0a0f',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 24,
    }}>
      {/* Logo */}
      <div style={{
        width: 96, height: 96, borderRadius: 24,
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.7), 0 0 50px var(--accent-glow)',
        animation: 'pulse 2s ease-in-out infinite',
      }}>
        <img
          src="/icons/icon-192.png"
          alt="KokoMusic"
          width="64"
          height="64"
          className="app-logo-accent"
          style={{ objectFit: 'contain' }}
        />
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 48px var(--accent-glow); transform: scale(1); }
          50%       { box-shadow: 0 0 72px var(--accent-glow); transform: scale(1.03); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Nombre */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: 28, fontWeight: 800, color: '#fff',
          letterSpacing: '-0.5px', marginBottom: 8,
        }}>
          KokoMusic
        </div>
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>
          Conectando con el backend{dots}
        </div>
      </div>

      {/* Spinner */}
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid var(--accent-glow)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 1s linear infinite',
      }} />

      {/* Mensaje de aviso si lleva tiempo */}
      {attempt >= 3 && (
        <div style={{
          position: 'absolute', bottom: 48, left: 24, right: 24,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, padding: '14px 18px',
          fontSize: 13, color: 'rgba(255,255,255,0.6)',
          textAlign: 'center', lineHeight: 1.5,
        }}>
          Iniciando servicio de reproducción embebido...
        </div>
      )}
    </div>
  );
}
