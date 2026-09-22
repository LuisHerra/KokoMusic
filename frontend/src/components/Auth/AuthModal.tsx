import React, { useState, useRef, useMemo } from 'react';
import { loginAccount, createAccount } from '../../lib/api';
import { startSpotifyAuth } from '../../lib/spotifyAuth';
import { useThemeStore, ACCENT_COLORS, hexToRgba, getLogoHueFilter } from '../../store/themeStore';
import { createClient } from '@supabase/supabase-js';
import kokoLogo from '../../assets/koko-logo.png';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [isRegister, setIsRegister] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // 3D Tilt & Glare State
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, scale: 1 });
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const { accentColor, customAccentHex } = useThemeStore();

  // Color de acento activo
  const activeAccent = useMemo(() => {
    if (accentColor === 'custom' && customAccentHex) {
      return customAccentHex;
    }
    return ACCENT_COLORS[accentColor]?.accent || '#1DB954';
  }, [accentColor, customAccentHex]);

  // Filtro dinámico de hue para adaptar el color del logo al acento activo
  const logoHueFilter = useMemo(() => {
    return getLogoHueFilter(activeAccent);
  }, [activeAccent]);

  if (!isOpen) return null;

  // Manejo de física 3D Tilt
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const xPct = (mouseX / width) * 100;
    const yPct = (mouseY / height) * 100;

    // Inclinación máxima de 10 grados
    const rX = -((mouseY - height / 2) / (height / 2)) * 9;
    const rY = ((mouseX - width / 2) / (width / 2)) * 9;

    setTilt({ rotateX: rX, rotateY: rY, scale: 1.015 });
    setGlare({ x: xPct, y: yPct, opacity: 0.18 });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTilt({ rotateX: 0, rotateY: 0, scale: 1 });
    setGlare(prev => ({ ...prev, opacity: 0 }));
  };

  const handleNativeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        if (!displayName.trim()) {
          throw new Error('El nombre de usuario es obligatorio');
        }
        const res = await createAccount({
          display_name: displayName.trim(),
          username: identifier.trim() || undefined,
          email: identifier.includes('@') ? identifier.trim() : undefined,
          password: password || undefined,
        });

        if (res.success && res.userId) {
          localStorage.setItem('koko_device_id', res.userId);
          localStorage.setItem('koko_display_name', res.profile.display_name || displayName.trim());
          localStorage.setItem('koko_auth_completed', 'true');
          window.dispatchEvent(new Event('storage'));
          if (onSuccess) onSuccess();
          onClose();
        } else {
          throw new Error('No se pudo registrar la cuenta');
        }
      } else {
        if (!identifier.trim()) {
          throw new Error('Por favor ingresa tu usuario o email');
        }
        const res = await loginAccount({
          identifier: identifier.trim(),
          password: password || undefined,
        });

        if (res.success && res.userId) {
          localStorage.setItem('koko_device_id', res.userId);
          if (res.profile.display_name) {
            localStorage.setItem('koko_display_name', res.profile.display_name);
          }
          if (res.profile.avatar_url) {
            localStorage.setItem('koko_avatar_url', res.profile.avatar_url);
          }
          localStorage.setItem('koko_auth_completed', 'true');
          window.dispatchEvent(new Event('storage'));
          if (onSuccess) onSuccess();
          onClose();
        } else {
          throw new Error('Credenciales incorrectas');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Error al procesar la solicitud');
    } finally {
      setLoading(false);
    }
  };

  const handleSpotifyLogin = () => {
    setSpotifyLoading(true);
    setError(null);
    startSpotifyAuth({
      origin: 'auth_modal',
      onSuccess: () => {
        setSpotifyLoading(false);
        localStorage.setItem('koko_auth_completed', 'true');
        window.dispatchEvent(new Event('storage'));
        if (onSuccess) onSuccess();
        onClose();
      },
      onError: (err) => {
        setSpotifyLoading(false);
        setError(err);
      },
      onClose: () => {
        setSpotifyLoading(false);
      },
    });
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        throw new Error('Google OAuth requiere configuración en Supabase');
      }
      const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { error: oAuthError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (oAuthError) throw oAuthError;
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar sesión con Google.');
      setGoogleLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        // Fondo traslúcido tipo glassmorphism que NO deja la pantalla negra sino desenfocada
        background: 'rgba(5, 7, 12, 0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        overflowY: 'auto',
        perspective: '1200px', // Habilita el espacio 3D
        fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* Halo ambiental suave del acento detrás del card */}
      <div
        style={{
          position: 'absolute',
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hexToRgba(activeAccent, 0.15)} 0%, rgba(0,0,0,0) 70%)`,
          filter: 'blur(40px)',
          pointerEvents: 'none',
          transform: 'translateZ(-50px)',
        }}
      />

      {/* Glassmorphism Card con 3D Tilt interactivo (Idéntico a la referencia) */}
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%)',
          backdropFilter: 'blur(32px) saturate(190%)',
          WebkitBackdropFilter: 'blur(32px) saturate(190%)',
          borderRadius: 36, // Esquinas redondeadas profundas de la referencia
          border: '1px solid rgba(255, 255, 255, 0.18)',
          boxShadow: `0 30px 80px rgba(0, 0, 0, 0.7), 0 0 35px ${hexToRgba(activeAccent, 0.12)}, inset 0 1px 1px rgba(255, 255, 255, 0.25)`,
          padding: '40px 32px 34px',
          boxSizing: 'border-box',
          position: 'relative',
          textAlign: 'center',
          transformStyle: 'preserve-3d',
          transform: `perspective(1000px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) scale3d(${tilt.scale}, ${tilt.scale}, ${tilt.scale})`,
          transition: isHovered ? 'transform 0.08s ease-out' : 'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)',
          overflow: 'hidden',
        }}
      >
        {/* Reflejo especular dinámico (3D Glare Sheen) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            borderRadius: 36,
            background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(255, 255, 255, ${glare.opacity}) 0%, transparent 60%)`,
            transition: 'opacity 0.25s ease',
          }}
        />

        {/* Logo Oficial de KokoMusic Individual (Sin forma circular contenedora) */}
        <div
          style={{
            margin: '0 auto 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'translateZ(32px)', // Profundidad 3D
          }}
        >
          <img
            src={kokoLogo}
            alt="KokoMusic Logo"
            style={{
              width: 72,
              height: 72,
              objectFit: 'contain',
              filter: `${logoHueFilter !== 'none' ? logoHueFilter + ' ' : ''}drop-shadow(0 8px 24px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 20px ${hexToRgba(activeAccent, 0.35)})`,
              userSelect: 'none',
              pointerEvents: 'none',
              transition: 'filter 0.3s ease',
            }}
          />
        </div>

        {/* Formulario minimalista con inputs subrayados idénticos a la referencia */}
        <form onSubmit={handleNativeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20, transform: 'translateZ(20px)' }}>
          {isRegister && (
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 2, color: 'rgba(255, 255, 255, 0.75)', display: 'flex' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nombre completo"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1.5px solid rgba(255, 255, 255, 0.4)',
                  color: '#ffffff',
                  fontSize: 14,
                  padding: '9px 10px 9px 32px',
                  outline: 'none',
                  letterSpacing: '0.4px',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.25s ease',
                  fontFamily: 'inherit',
                }}
                onFocus={(e) => { e.currentTarget.style.borderBottomColor = activeAccent; }}
                onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(255, 255, 255, 0.4)'; }}
              />
            </div>
          )}

          {/* Input Email / Usuario con icono de sobre */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 2, color: 'rgba(255, 255, 255, 0.75)', display: 'flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </span>
            <input
              type={isRegister ? 'email' : 'text'}
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={isRegister ? 'Email ID' : 'Email ID o Usuario'}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.4)',
                color: '#ffffff',
                fontSize: 14,
                padding: '9px 10px 9px 32px',
                outline: 'none',
                letterSpacing: '0.4px',
                boxSizing: 'border-box',
                transition: 'border-color 0.25s ease',
                fontFamily: 'inherit',
              }}
              onFocus={(e) => { e.currentTarget.style.borderBottomColor = activeAccent; }}
              onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(255, 255, 255, 0.4)'; }}
            />
          </div>

          {/* Input Contraseña con icono de candado */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 2, color: 'rgba(255, 255, 255, 0.75)', display: 'flex' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegister ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña'}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1.5px solid rgba(255, 255, 255, 0.4)',
                color: '#ffffff',
                fontSize: 14,
                padding: '9px 10px 9px 32px',
                outline: 'none',
                letterSpacing: '0.4px',
                boxSizing: 'border-box',
                transition: 'border-color 0.25s ease',
                fontFamily: 'inherit',
              }}
              onFocus={(e) => { e.currentTarget.style.borderBottomColor = activeAccent; }}
              onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'rgba(255, 255, 255, 0.4)'; }}
            />
          </div>

          {error && (
            <div
              style={{
                background: 'rgba(255, 80, 80, 0.15)',
                border: '1px solid rgba(255, 80, 80, 0.3)',
                color: '#ff7b7b',
                padding: '8px 12px',
                borderRadius: 10,
                fontSize: 12,
                textAlign: 'left',
              }}
            >
              {error}
            </div>
          )}

          {/* Botón Principal con Gradiente de NEGRO A COLOR DE ACENTO (Sin sobresalir píxeles) */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              background: `linear-gradient(90deg, #101014 0%, ${activeAccent} 100%)`,
              color: '#ffffff',
              border: 'none',
              outline: 'none',
              borderRadius: 9999,
              padding: '13px 24px',
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: '2.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: `inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 10px 26px rgba(0, 0, 0, 0.5), 0 0 20px ${hexToRgba(activeAccent, 0.3)}`,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              marginTop: 6,
              fontFamily: 'inherit',
              overflow: 'hidden',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 12px 30px rgba(0, 0, 0, 0.6), 0 0 28px ${hexToRgba(activeAccent, 0.45)}`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 10px 26px rgba(0, 0, 0, 0.5), 0 0 20px ${hexToRgba(activeAccent, 0.3)}`;
            }}
          >
            {loading ? 'CARGANDO...' : isRegister ? 'REGISTRARSE' : 'LOGIN'}
          </button>
        </form>

        {/* Separador de opciones de Social OAuth */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 16px', transform: 'translateZ(15px)' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.12)' }} />
          <span style={{ fontSize: 10, color: 'rgba(255, 255, 255, 0.45)', textTransform: 'uppercase', letterSpacing: 1.2 }}>
            o acceder con
          </span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255, 255, 255, 0.12)' }} />
        </div>

        {/* Botones de Spotify y Google (Añadidos según lo solicitado) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18, transform: 'translateZ(20px)' }}>
          {/* Botón Spotify */}
          <button
            type="button"
            onClick={handleSpotifyLogin}
            disabled={spotifyLoading}
            style={{
              background: 'rgba(29, 185, 84, 0.12)',
              border: '1px solid rgba(29, 185, 84, 0.35)',
              borderRadius: 14,
              padding: '10px 14px',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(29, 185, 84, 0.22)';
              e.currentTarget.style.borderColor = '#1DB954';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(29, 185, 84, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(29, 185, 84, 0.35)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#1DB954">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 17.3a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 01-.34-1.46c4.58-1.04 8.52-.6 11.67 1.33.35.21.46.68.25 1.04zm1.47-3.26a.94.94 0 01-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 01-.55-1.8c4.37-1.33 9.8-.69 13.5 1.59.4.25.53.78.31 1.3zm.13-3.39c-3.87-2.3-10.26-2.51-13.97-1.38a1.13 1.13 0 01-.66-2.16c4.27-1.3 11.33-1.04 15.8 1.61a1.13 1.13 0 01-1.17 1.93z" />
            </svg>
            {spotifyLoading ? '...' : 'Spotify'}
          </button>

          {/* Botón Google */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.16)',
              borderRadius: 14,
              padding: '10px 14px',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            {googleLoading ? '...' : 'Google'}
          </button>
        </div>

        {/* Footer: Alternar entre Iniciar Sesión / Registro */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, transform: 'translateZ(15px)' }}>
          <button
            type="button"
            onClick={() => { setIsRegister(!isRegister); setError(null); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.75)',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {isRegister ? (
              <span>¿Ya tienes cuenta? <b style={{ color: activeAccent }}>Inicia sesión</b></span>
            ) : (
              <span>¿No tienes cuenta? <b style={{ color: activeAccent }}>Regístrate</b></span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
