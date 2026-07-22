import React, { useState } from 'react';
import type { VoiceControlState, VoiceActionId } from '../hooks/useVoiceControl';
import { DEFAULT_VOICE_COMMANDS } from '../hooks/useVoiceControl';

interface VoiceControlModalProps {
  voiceControl: VoiceControlState;
  isOpen: boolean;
  onClose: () => void;
}

export function IconMic({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

const ACTION_LABELS: Record<VoiceActionId, string> = {
  play: 'Reproducir',
  pause: 'Pausar',
  next: 'Siguiente canción',
  prev: 'Canción anterior',
  vol_up: 'Subir volumen',
  vol_down: 'Bajar volumen',
  like: 'Añadir a Me Gusta',
  lyrics: 'Mostrar / Ocultar Letras',
  queue: 'Mostrar / Ocultar Cola',
  shuffle: 'Modo Aleatorio',
  repeat: 'Modo Repetición',
};

export default function VoiceControlModal({ voiceControl, isOpen, onClose }: VoiceControlModalProps) {
  const [activeTab, setActiveTab] = useState<'listen' | 'customize'>('listen');
  const [editingAction, setEditingAction] = useState<VoiceActionId | null>(null);
  const [editingInput, setEditingInput] = useState('');

  if (!isOpen) return null;

  const {
    isListening,
    transcript,
    interimTranscript,
    feedback,
    error,
    isSupported,
    customCommands,
    toggleListening,
    updateCustomCommand,
    resetCustomCommands,
  } = voiceControl;

  const handleStartEditing = (action: VoiceActionId) => {
    setEditingAction(action);
    const existing = customCommands[action] || DEFAULT_VOICE_COMMANDS[action] || [];
    setEditingInput(existing.join(', '));
  };

  const handleSaveEditing = (action: VoiceActionId) => {
    const phrases = editingInput
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    updateCustomCommand(action, phrases.length > 0 ? phrases : DEFAULT_VOICE_COMMANDS[action]);
    setEditingAction(null);
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, rgba(28, 28, 35, 0.96), rgba(18, 18, 22, 0.99))',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 24,
          padding: 28,
          maxWidth: 520,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
          color: '#ffffff',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            color: '#aaa',
            width: 32,
            height: 32,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#aaa')}
        >
          ✕
        </button>

        {/* Header & Mode Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Control por Voz
          </h2>
          <span
            style={{
              background: 'rgba(29, 185, 84, 0.15)',
              border: '1px solid rgba(29, 185, 84, 0.4)',
              color: '#1DB954',
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}
          >
            Alt + V
          </span>
        </div>

        {/* Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'rgba(0,0,0,0.3)',
            padding: 4,
            borderRadius: 12,
            marginBottom: 20,
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <button
            onClick={() => setActiveTab('listen')}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'listen' ? '#1DB954' : 'transparent',
              color: activeTab === 'listen' ? '#000' : '#aaa',
              transition: 'all 0.2s',
            }}
          >
            Escuchar
          </button>
          <button
            onClick={() => setActiveTab('customize')}
            style={{
              padding: '6px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: activeTab === 'customize' ? '#1DB954' : 'transparent',
              color: activeTab === 'customize' ? '#000' : '#aaa',
              transition: 'all 0.2s',
            }}
          >
            Personalizar Comandos
          </button>
        </div>

        {activeTab === 'listen' ? (
          <>
            <p style={{ color: '#aaa', fontSize: 13, margin: '0 0 20px 0' }}>
              {isSupported
                ? 'Di un comando o una canción para reproducir (fallback YouTube automático si no está en catálogo).'
                : 'Tu navegador no soporta la API de reconocimiento de voz.'}
            </p>

            {/* Microphone Animated Visualizer */}
            <div style={{ position: 'relative', margin: '10px 0 20px 0' }}>
              {isListening && (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      inset: -12,
                      borderRadius: '50%',
                      background: 'rgba(29, 185, 84, 0.25)',
                      animation: 'pulseRing 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: -24,
                      borderRadius: '50%',
                      background: 'rgba(29, 185, 84, 0.15)',
                      animation: 'pulseRing 1.5s cubic-bezier(0.215, 0.61, 0.355, 1) infinite 0.4s',
                    }}
                  />
                </>
              )}

              <button
                onClick={toggleListening}
                disabled={!isSupported}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: isListening
                    ? 'linear-gradient(135deg, #1DB954, #1aa34a)'
                    : 'linear-gradient(135deg, #2a2a35, #1f1f28)',
                  border: isListening ? '3px solid #ffffff' : '2px solid rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: isSupported ? 'pointer' : 'not-allowed',
                  boxShadow: isListening
                    ? '0 0 30px rgba(29, 185, 84, 0.6)'
                    : '0 8px 20px rgba(0,0,0,0.3)',
                  transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                <IconMic size={34} color={isListening ? '#000000' : '#ffffff'} />
              </button>
            </div>

            {/* Live Transcript / Speech Status */}
            <div
              style={{
                minHeight: 48,
                width: '100%',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 14,
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              {isListening ? (
                <span style={{ fontSize: 14, fontWeight: 500, color: interimTranscript || transcript ? '#1DB954' : '#888' }}>
                  {interimTranscript || transcript || 'Escuchando... di tu comando'}
                </span>
              ) : (
                <span style={{ fontSize: 13, color: '#aaa' }}>
                  Haz clic en el micrófono o usa <strong style={{ color: '#fff' }}>Alt + V</strong>
                </span>
              )}
            </div>

            {/* Feedback / Recognized Command Alert */}
            {feedback && (
              <div
                style={{
                  width: '100%',
                  background: 'rgba(29, 185, 84, 0.15)',
                  border: '1px solid rgba(29, 185, 84, 0.4)',
                  color: '#1DB954',
                  borderRadius: 12,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                {feedback}
              </div>
            )}

            {/* Error Alert */}
            {error && (
              <div
                style={{
                  width: '100%',
                  background: 'rgba(235, 87, 87, 0.15)',
                  border: '1px solid rgba(235, 87, 87, 0.4)',
                  color: '#eb5757',
                  borderRadius: 12,
                  padding: '10px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16,
                }}
              >
                {error}
              </div>
            )}

            {/* Voice Command Quick Suggestions */}
            <div style={{ width: '100%', textAlign: 'left', marginTop: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#666', letterSpacing: '0.08em' }}>
                Comandos de Voz Rápidos
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  marginTop: 8,
                  fontSize: 12,
                }}
              >
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 8, color: '#ddd' }}>
                  <span style={{ color: '#1DB954', fontWeight: 600 }}>"Siguiente"</span> / <span style={{ color: '#1DB954', fontWeight: 600 }}>"Anterior"</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 8, color: '#ddd' }}>
                  <span style={{ color: '#1DB954', fontWeight: 600 }}>"Pausar"</span> / <span style={{ color: '#1DB954', fontWeight: 600 }}>"Reproducir"</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 8, color: '#ddd' }}>
                  <span style={{ color: '#1DB954', fontWeight: 600 }}>"Subir volumen"</span> / <span style={{ color: '#1DB954', fontWeight: 600 }}>"Bajar"</span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '8px 12px', borderRadius: 8, color: '#ddd' }}>
                  <span style={{ color: '#1DB954', fontWeight: 600 }}>"Reproducir [canción/artista]"</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ── Custom Commands Tab ── */
          <div style={{ width: '100%', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>
                Asigna tus propias palabras claves para cada acción.
              </p>
              <button
                onClick={resetCustomCommands}
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#aaa',
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Restablecer
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(Object.keys(ACTION_LABELS) as VoiceActionId[]).map((action) => {
                const phrases = customCommands[action] || DEFAULT_VOICE_COMMANDS[action] || [];
                const isEditing = editingAction === action;

                return (
                  <div
                    key={action}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: 12,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#ffffff' }}>
                        {ACTION_LABELS[action]}
                      </span>
                      {!isEditing ? (
                        <button
                          onClick={() => handleStartEditing(action)}
                          style={{
                            background: 'rgba(29, 185, 84, 0.15)',
                            border: '1px solid rgba(29, 185, 84, 0.3)',
                            color: '#1DB954',
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          Editar
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSaveEditing(action)}
                          style={{
                            background: '#1DB954',
                            border: 'none',
                            color: '#000000',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          Guardar
                        </button>
                      )}
                    </div>

                    {isEditing ? (
                      <input
                        type="text"
                        value={editingInput}
                        onChange={(e) => setEditingInput(e.target.value)}
                        placeholder="Palabras separadas por comas (ej: siguiente, pasar)"
                        style={{
                          width: '100%',
                          background: 'rgba(0, 0, 0, 0.4)',
                          border: '1px solid #1DB954',
                          color: '#ffffff',
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 13,
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {phrases.map((p, idx) => (
                          <span
                            key={idx}
                            style={{
                              background: 'rgba(255, 255, 255, 0.08)',
                              color: '#ddd',
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 4,
                            }}
                          >
                            "{p}"
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <style>{`
          @keyframes pulseRing {
            0% { transform: scale(0.95); opacity: 0.8; }
            100% { transform: scale(1.4); opacity: 0; }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.96); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}
