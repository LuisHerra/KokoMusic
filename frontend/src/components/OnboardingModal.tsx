import React, { useState, useRef } from 'react';
import { submitOnboarding, importSpotifyHistory } from '../lib/api';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_GENRES = [
  'Reggaeton', 'Trap', 'Urbano Latino', 'Phonk', 'R&B', 'Pop', 
  'Hip-Hop', 'Rap', 'Rock', 'Electrónica', 'Phonk Brasileño', 'Afrobeat'
];

const PRESET_ARTISTS = [
  'Feid', 'Quevedo', 'Bad Bunny', 'Morad', 'Trueno', 'JC Reyes', 
  'Myke Towers', 'Charlie Puth', 'KeBlack', 'Santiago', 'Omar Courtz',
  'Santiago', 'Oasis', 'GIMS', 'Ninho', 'PLK', 'Tiakola', 'Naza'
];

export default function OnboardingModal({ isOpen, onClose, onSuccess }: OnboardingModalProps) {
  const [step, setStep] = useState<'welcome' | 'genres_artists' | 'spotify_import' | 'success'>('welcome');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [customArtistInput, setCustomArtistInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importStats, setImportStats] = useState<{
    totalPlays: number;
    uniqueTracks: number;
    resolved: number;
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const toggleArtist = (artist: string) => {
    setSelectedArtists(prev => 
      prev.includes(artist) ? prev.filter(a => a !== artist) : [...prev, artist]
    );
  };

  const addCustomArtist = (e: React.FormEvent) => {
    e.preventDefault();
    const artist = customArtistInput.trim();
    if (artist && !selectedArtists.includes(artist)) {
      setSelectedArtists(prev => [...prev, artist]);
      setCustomArtistInput('');
    }
  };

  const removeArtist = (artist: string) => {
    setSelectedArtists(prev => prev.filter(a => a !== artist));
  };

  const handlePreferencesSubmit = async () => {
    if (selectedGenres.length === 0 && selectedArtists.length === 0) {
      alert('Por favor selecciona al menos un género o artista');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitOnboarding(selectedGenres, selectedArtists);
      setStep('success');
    } catch (err: any) {
      console.error('Error al guardar preferencias:', err);
      alert('No se pudo guardar tu perfil. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);
    setIsSubmitting(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        let historyArray: any[] = [];
        try {
          const parsed = JSON.parse(text);
          historyArray = Array.isArray(parsed) ? parsed : [parsed];
        } catch (jsonErr) {
          // Intentar parsear como JSON Lines (JSONL)
          const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
          if (lines.length > 0) {
            try {
              historyArray = lines.map(line => JSON.parse(line));
            } catch (lineErr) {
              throw new Error('El archivo no es un JSON ni un JSONL válido de Spotify.');
            }
          } else {
            throw jsonErr;
          }
        }
        
        // Validar formato mínimo de Spotify (puede ser Extended, Legacy o Normalizado)
        const sample = historyArray[0];
        const isValid = sample && (
          (sample.master_metadata_track_name || sample.trackName || sample.track_name) &&
          (sample.master_metadata_album_artist_name || sample.artistName || sample.artist_name)
        );

        if (!isValid) {
          throw new Error('El formato del archivo no coincide con el historial de Spotify. Asegúrate de subir un archivo StreamingHistory o el archivo de historial limpio normalizado.');
        }

        const res = await importSpotifyHistory(historyArray);
        if (res.success) {
          setImportStats({
            totalPlays: res.totalPlaysImported,
            uniqueTracks: res.uniqueTracksImported,
            resolved: res.tracksResolved
          });
          setStep('success');
        } else {
          throw new Error('El backend no pudo procesar el historial');
        }
      } catch (err: any) {
        console.error('Error importando historial:', err);
        setFileError(err.message || 'Error al procesar el archivo. Asegúrate de que sea un JSON válido de Spotify.');
      } finally {
        setIsSubmitting(false);
      }
    };

    reader.readAsText(file);
  };

  const handleFinish = () => {
    onSuccess();
    onClose();
  };

  return (
    <div className="onboarding-overlay" style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)',
      backdropFilter: 'blur(20px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    }}>
      <div className="onboarding-card" style={{
        width: '100%',
        maxWidth: 640,
        background: 'var(--bg-elevated)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.8)',
        maxHeight: '90vh',
        overflowY: 'auto',
        position: 'relative'
      }}>
        
        {step !== 'success' && (
          <button 
            onClick={onClose} 
            style={{
              position: 'absolute',
              top: 20, right: 20,
              background: 'none', border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 20
            }}
            title="Cerrar"
          >
            ✕
          </button>
        )}

        {step === 'welcome' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64,
              background: 'linear-gradient(135deg, var(--accent), #0f8b3c)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 8px 24px rgba(29, 185, 84, 0.3)'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="black">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Personaliza tu Recomendación</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.5, marginBottom: 32 }}>
              ¿Cómo quieres que KokoMusic aprenda de tus gustos? Elige una opción para sintonizar tu Koko-Mix y evitar canciones repetitivas.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Option A */}
              <div 
                onClick={() => setStep('genres_artists')}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 'var(--radius-md)',
                  padding: 24,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left'
                }}
                className="onboarding-opt-card"
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 12 }}>🎵</div>
                <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Seleccionar Gustos</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
                  Elige tus géneros y artistas urbanos favoritos directamente en una lista interactiva.
                </p>
              </div>

              {/* Option B */}
              <div 
                onClick={() => setStep('spotify_import')}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 'var(--radius-md)',
                  padding: 24,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left'
                }}
                className="onboarding-opt-card"
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 12 }}>🚀</div>
                <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Historial Spotify</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4 }}>
                  Importa tus archivos Extended Streaming History (.json) para transferir todas tus reproducciones.
                </p>
              </div>
            </div>
          </div>
        )}

        {step === 'genres_artists' && (
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Tus Preferencias</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Elige los géneros y artistas que escuchas habitualmente para crear tu base musical.
            </p>

            {/* Géneros */}
            <h4 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 12 }}>Géneros</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {PRESET_GENRES.map(genre => {
                const isSelected = selectedGenres.includes(genre);
                return (
                  <button
                    key={genre}
                    onClick={() => toggleGenre(genre)}
                    style={{
                      background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                      color: isSelected ? '#000000' : 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 'var(--radius-full)',
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {genre} {isSelected && '✓'}
                  </button>
                );
              })}
            </div>

            {/* Artistas Predefinidos */}
            <h4 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 12 }}>Artistas Recomendados</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {PRESET_ARTISTS.map(artist => {
                const isSelected = selectedArtists.includes(artist);
                return (
                  <button
                    key={artist}
                    onClick={() => toggleArtist(artist)}
                    style={{
                      background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
                      color: isSelected ? '#000000' : 'var(--text-primary)',
                      border: 'none',
                      borderRadius: 'var(--radius-full)',
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {artist} {isSelected && '✓'}
                  </button>
                );
              })}
            </div>

            {/* Artistas Personalizados */}
            <h4 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5, marginBottom: 12 }}>Añadir otros artistas</h4>
            <form onSubmit={addCustomArtist} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={customArtistInput}
                onChange={e => setCustomArtistInput(e.target.value)}
                placeholder="Ej. Quevedo, Bad Bunny, Morad..."
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-md)',
                  color: '#fff',
                  padding: '10px 16px',
                  fontSize: 14,
                  outline: 'none'
                }}
              />
              <button 
                type="submit"
                style={{
                  background: 'var(--text-primary)',
                  color: '#000000',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  padding: '0 20px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Añadir
              </button>
            </form>

            {/* Custom selected items view */}
            {selectedArtists.filter(a => !PRESET_ARTISTS.includes(a)).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 32 }}>
                {selectedArtists.filter(a => !PRESET_ARTISTS.includes(a)).map(artist => (
                  <span
                    key={artist}
                    style={{
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: 'var(--radius-full)',
                      padding: '6px 12px',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    {artist}
                    <button 
                      onClick={() => removeArtist(artist)}
                      style={{ background: 'none', border: 'none', color: 'red', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Acciones */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
              <button
                onClick={() => setStep('welcome')}
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                ← Atrás
              </button>
              <button
                onClick={handlePreferencesSubmit}
                disabled={isSubmitting}
                style={{
                  background: 'var(--accent)',
                  color: '#000000',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  padding: '12px 32px',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                {isSubmitting ? 'Guardando...' : 'Sintonizar KokoMusic ✓'}
              </button>
            </div>
          </div>
        )}

        {step === 'spotify_import' && (
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Importar desde Spotify</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Sube tus archivos JSON de Extended Streaming History de Spotify. Esto asociará tus reproducciones con las canciones de la base de datos para afinar el algoritmo.
            </p>

            <div 
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed rgba(255, 255, 255, 0.15)',
                borderRadius: 'var(--radius-lg)',
                padding: '48px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.02)',
                transition: 'all 0.2s ease',
                marginBottom: 20
              }}
              onDragOver={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.background = 'rgba(29, 185, 84, 0.05)';
              }}
              onDragLeave={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                  if (fileInputRef.current) {
                    fileInputRef.current.files = files;
                    const event = { target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>;
                    handleFileUpload(event);
                  }
                }
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".json"
                style={{ display: 'none' }}
              />

              {isSubmitting ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <div className="spinner" style={{ width: 36, height: 36 }}></div>
                  <h4 style={{ fontSize: 16, fontWeight: 600 }}>Procesando historial...</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    Esto puede tomar unos segundos mientras resolvemos IDs de canciones en Supabase
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📥</div>
                  <h4 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Arrastra o selecciona tu archivo JSON</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4, maxWidth: 380, margin: '0 auto' }}>
                    Sube archivos tipo <code>StreamingHistory_music_0.json</code> o <code>AudioPlay.json</code> de tu cuenta de Spotify.
                  </p>
                </>
              )}
            </div>

            {fileError && (
              <div style={{
                background: 'rgba(192, 57, 43, 0.1)',
                border: '1px solid rgba(192, 57, 43, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: '#e74c3c',
                padding: '12px 16px',
                fontSize: 13,
                marginBottom: 20
              }}>
                ⚠️ {fileError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                onClick={() => setStep('welcome')}
                style={{
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: 'none',
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                ← Atrás
              </button>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Se ignoran saltos de canciones de menos de 10s.
              </span>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{
              width: 56, height: 56,
              background: '#2ecc71',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
              color: '#000',
              fontSize: 24
            }}>
              ✓
            </div>
            
            {importStats ? (
              <>
                <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>¡Historial Importado!</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                  Hemos analizado tus archivos de Spotify y transferido tu historial a KokoMusic.
                </p>
                
                <div style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 'var(--radius-md)',
                  padding: 20,
                  maxWidth: 360,
                  margin: '0 auto 32px',
                  textAlign: 'left',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Reproducciones válidas:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{importStats.totalPlays}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Tracks únicos:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{importStats.uniqueTracks}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Enlazados en DB:</span>
                    <strong style={{ color: 'var(--accent)' }}>{importStats.resolved}</strong>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>¡Gusto Sintonizado!</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 32 }}>
                  Preferencias guardadas. Tu perfil de gustos musical ya está activo y tu recomendador está calculando tus nuevas sugerencias.
                </p>
              </>
            )}

            <button
              onClick={handleFinish}
              style={{
                background: 'var(--accent)',
                color: '#000000',
                border: 'none',
                borderRadius: 'var(--radius-full)',
                padding: '14px 48px',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              ¡Comenzar a escuchar!
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
