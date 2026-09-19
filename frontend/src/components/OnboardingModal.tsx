import React, { useState, useRef, useEffect } from 'react';
import { submitOnboarding, importSpotifyHistory, getAvailableCDNTracks } from '../lib/api';
import { useLikedSongs } from '../hooks/useLikedSongs';
import { startSpotifyAuth } from '../lib/spotifyAuth';
import kokoLogo from '../assets/koko-logo.png';

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
  'Myke Towers', 'Mora', 'Rauw Alejandro', 'Duki', 'Anuel AA',
  'Eladio Carrión', 'Saiko', 'Milo J', 'Cris Mj', 'De La Rose'
];

interface SeedSong {
  id: string;
  title: string;
  artist: string;
  cover: string;
}

const DEFAULT_SAMPLE_SONGS: SeedSong[] = [
  { id: 'sample-luna', title: 'LUNA', artist: 'Feid, ATL Jacob', cover: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-columbia', title: 'Columbia', artist: 'Quevedo', cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-monaco', title: 'MONACO', artist: 'Bad Bunny', cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-pelele', title: 'Pelele', artist: 'Morad', cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-mamichula', title: 'Mamichula', artist: 'Trueno, Nicki Nicole', cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-lala', title: 'LALA', artist: 'Myke Towers', cover: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-bizarrap-52', title: 'Bzrp Sessions #52', artist: 'Bizarrap, Quevedo', cover: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=80' },
  { id: 'sample-coronamos', title: 'Coronamos', artist: 'JC Reyes', cover: 'https://images.unsplash.com/photo-1511735111819-9a3f7709049c?w=150&auto=format&fit=crop&q=80' },
];

export default function OnboardingModal({ isOpen, onClose, onSuccess }: OnboardingModalProps) {
  const [step, setStep] = useState<'welcome' | 'genres_artists' | 'spotify_import' | 'success'>('welcome');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedArtists, setSelectedArtists] = useState<string[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<string[]>([]);
  const [songsList, setSongsList] = useState<SeedSong[]>(DEFAULT_SAMPLE_SONGS);
  const [customArtistInput, setCustomArtistInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [importStats, setImportStats] = useState<{
    totalPlays: number;
    uniqueTracks: number;
    resolved: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const { isLiked, toggleLike } = useLikedSongs();

  useEffect(() => {
    getAvailableCDNTracks(1, 16)
      .then((res) => {
        if (res?.tracks && res.tracks.length > 0) {
          const formatted = res.tracks.map((t) => ({
            id: String(t.id),
            title: t.title,
            artist: t.artist,
            cover: t.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=80',
          }));
          setSongsList(formatted);
        }
      })
      .catch(() => {
        // Fallback already in DEFAULT_SAMPLE_SONGS
      });
  }, []);

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

  const toggleTrackLike = (song: SeedSong) => {
    const isCurrentlyLiked = selectedTrackIds.includes(song.id) || isLiked(song.id);
    if (isCurrentlyLiked) {
      setSelectedTrackIds(prev => prev.filter(id => id !== song.id));
    } else {
      setSelectedTrackIds(prev => [...prev, song.id]);
      const primaryArtist = song.artist.split(',')[0].trim();
      if (primaryArtist && !selectedArtists.includes(primaryArtist)) {
        setSelectedArtists(prev => [...prev, primaryArtist]);
      }
    }
    toggleLike(song.id);
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
    if (selectedGenres.length === 0 && selectedArtists.length === 0 && selectedTrackIds.length === 0) {
      alert('Por favor selecciona al menos un género, artista o canción favorita');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitOnboarding(selectedGenres, selectedArtists, selectedTrackIds);
      setStep('success');
    } catch (err: any) {
      console.error('Error al guardar preferencias:', err);
      alert('No se pudo guardar tu perfil. Intenta de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSpotifyConnect = () => {
    setSpotifyLoading(true);
    setSpotifyError(null);
    startSpotifyAuth({
      origin: 'onboarding',
      onSuccess: (payload) => {
        setSpotifyLoading(false);
        setImportStats({
          totalPlays: 50,
          uniqueTracks: payload.topTracks?.length || 25,
          resolved: payload.topArtists?.length || 25,
        });
        setStep('success');
      },
      onError: (err) => {
        setSpotifyLoading(false);
        setSpotifyError(err);
      },
      onClose: () => {
        setSpotifyLoading(false);
      },
    });
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
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
        boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85), 0 0 45px var(--accent-glow), 0 0 90px var(--accent-glow)',
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
            {/* Logo Oficial de KokoMusic Individual (Sin forma circular contenedora) */}
            <div style={{
              margin: '0 auto 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <img
                src={kokoLogo}
                alt="KokoMusic Logo"
                className="app-logo-accent"
                style={{
                  width: 68,
                  height: 68,
                  objectFit: 'contain',
                  filter: 'drop-shadow(0 8px 20px rgba(0, 0, 0, 0.55)) drop-shadow(0 0 20px var(--accent-glow))',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              />
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Personaliza tu Recomendación</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.5, marginBottom: 28 }}>
              ¿Cómo quieres que KokoMusic aprenda de tus gustos? Elige una opción para sintonizar tu Koko-Mix y evitar canciones repetitivas.
            </p>

            {/* Opción Prioritaria Elegante: Seleccionar Gustos (Sin estridencias, SVG balanceado) */}
            <div
              onClick={() => setStep('genres_artists')}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                cursor: 'pointer',
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                transition: 'all 0.2s ease',
                textAlign: 'left',
              }}
              className="onboarding-opt-card"
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px var(--accent-glow)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <h4 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: '#fff' }}>Seleccionar Gustos</h4>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 10 }}>
                    Recomendado
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0, lineHeight: 1.4 }}>
                  Elige tus géneros, artistas y canciones favoritas para tu perfil interactivo.
                </p>
              </div>
            </div>

            {/* Opciones Secundarias: Spotify y JSON */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              {/* Opción Spotify */}
              <div
                onClick={handleSpotifyConnect}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius-md)',
                  padding: 20,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left'
                }}
                className="onboarding-opt-card"
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(29, 185, 84, 0.08)';
                  e.currentTarget.style.borderColor = '#1DB954';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(29, 185, 84, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="#1DB954">
                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 17.3a.75.75 0 01-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 01-.34-1.46c4.58-1.04 8.52-.6 11.67 1.33.35.21.46.68.25 1.04zm1.47-3.26a.94.94 0 01-1.29.31c-3.23-1.99-8.15-2.56-11.97-1.4a.94.94 0 01-.55-1.8c4.37-1.33 9.8-.69 13.5 1.59.4.25.53.78.31 1.3zm.13-3.39c-3.87-2.3-10.26-2.51-13.97-1.38a1.13 1.13 0 01-.66-2.16c4.27-1.3 11.33-1.04 15.8 1.61a1.13 1.13 0 01-1.17 1.93z" />
                  </svg>
                </div>
                <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Conectar Spotify</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4, margin: 0 }}>
                  {spotifyLoading ? 'Conectando...' : 'Sincroniza tus artistas favoritos sin subir archivos.'}
                </p>
              </div>

              {/* Opción JSON */}
              <div
                onClick={() => setStep('spotify_import')}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius-md)',
                  padding: 20,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  textAlign: 'left'
                }}
                className="onboarding-opt-card"
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.06)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent)',
                  marginBottom: 12,
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h4 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Archivos JSON</h4>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4, margin: 0 }}>
                  Sube tus archivos Extended Streaming History (.json).
                </p>
              </div>
            </div>

            {spotifyError && (
              <div style={{ color: '#ff6b6b', fontSize: 12, background: 'rgba(255,107,107,0.1)', padding: '10px 14px', borderRadius: 10, marginBottom: 16 }}>
                {spotifyError}
              </div>
            )}

            {/* Footer: Acción única directa para no volver a preguntar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 20,
              paddingTop: 16,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            }}>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('koko_onboarding_dismissed', 'true');
                  onClose();
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '6px 14px',
                  borderRadius: 8,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = '#fff';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'var(--text-secondary)';
                  e.currentTarget.style.background = 'none';
                }}
              >
                No volver a preguntar
              </button>
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

            {/* Canciones que te gustan */}
            <div style={{ marginTop: 24, marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5, margin: 0 }}>
                  Canciones que te gustan
                </h4>
                {selectedTrackIds.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, background: 'var(--accent-glow)', padding: '2px 8px', borderRadius: 8 }}>
                    {selectedTrackIds.length} {selectedTrackIds.length === 1 ? 'canción indicada' : 'canciones indicadas'}
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 14px', lineHeight: 1.4 }}>
                Toca el corazón en las canciones que te agraden para afinar el algoritmo con tus temas favoritos.
              </p>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 10,
                maxHeight: 250,
                overflowY: 'auto',
                paddingRight: 4,
              }}>
                {songsList.map(song => {
                  const isTrackLiked = selectedTrackIds.includes(song.id) || isLiked(song.id);
                  return (
                    <div
                      key={song.id}
                      onClick={() => toggleTrackLike(song)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: isTrackLiked ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                        border: isTrackLiked ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.07)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={e => {
                        if (!isTrackLiked) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isTrackLiked) {
                          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
                        }
                      }}
                    >
                      <img
                        src={song.cover}
                        alt={song.title}
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 6,
                          objectFit: 'cover',
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: '#fff',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {song.title}
                        </div>
                        <div style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {song.artist}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleTrackLike(song);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 6,
                          cursor: 'pointer',
                          color: isTrackLiked ? 'var(--accent)' : 'var(--text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'transform 0.15s ease, color 0.15s ease',
                        }}
                        title={isTrackLiked ? 'Quitar de favoritos' : 'Me gusta'}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill={isTrackLiked ? 'var(--accent)' : 'none'}
                          stroke={isTrackLiked ? 'var(--accent)' : 'currentColor'}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

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
                  <div style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--accent)',
                    margin: '0 auto 12px',
                  }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  </div>
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
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {fileError}
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
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12 19 5 12 12 5" />
                </svg>
                Atrás
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
              background: 'var(--accent)',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px',
              color: '#000',
              boxShadow: '0 8px 24px var(--accent-glow)',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
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
