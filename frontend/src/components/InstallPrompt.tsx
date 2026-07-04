/**
 * InstallPrompt.tsx
 * Banner nativo de instalación PWA para Android Chrome.
 * Aparece automáticamente cuando Chrome detecta que la app es instalable.
 */
import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // No mostrar si ya está instalada como PWA (display: standalone)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    // No mostrar si el usuario ya la rechazó
    if (localStorage.getItem('koko_pwa_dismissed')) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => setInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('koko_pwa_dismissed', '1');
    setVisible(false);
  };

  if (!visible || installed) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
      left: 16,
      right: 16,
      zIndex: 9999,
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      border: '1px solid rgba(29, 185, 84, 0.3)',
      borderRadius: 16,
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(29,185,84,0.1)',
      animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>

      {/* Icono */}
      <div style={{
        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
        background: 'linear-gradient(135deg, #1db954, #0a7a35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="black">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
      </div>

      {/* Texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 2 }}>
          Instalar KokoMusic
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.4 }}>
          Añade la app a tu pantalla de inicio
        </div>
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8, padding: '8px 12px', color: 'rgba(255,255,255,0.6)',
            fontSize: 13, cursor: 'pointer', fontWeight: 500,
          }}
        >
          Ahora no
        </button>
        <button
          onClick={handleInstall}
          style={{
            background: '#1db954', border: 'none',
            borderRadius: 8, padding: '8px 16px', color: '#000',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Instalar
        </button>
      </div>
    </div>
  );
}
