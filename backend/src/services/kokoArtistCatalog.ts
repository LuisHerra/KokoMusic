/**
 * Catálogo de canciones publicadas por artistas de KokoMusic (usuarios con
 * is_artist). Es diminuto (pocos usuarios), así que se carga entero en memoria
 * y se filtra ahí — sirve para inyectarlo en búsquedas (iTunes/YouTube no lo
 * conocen) y para darle un pequeño empujón por género en las recomendaciones.
 */

import { supabase } from './supabaseService';
import type { TrackMetadata } from './metadataService';
import type { ArtistInfo } from './artistService';

const TTL_MS = 60 * 1000;
let cached: { tracks: TrackMetadata[]; expires: number } | null = null;

export function invalidateKokoArtistCatalog(): void {
  cached = null;
  artistsCache = null;
}

export async function getKokoArtistTracks(): Promise<TrackMetadata[]> {
  if (cached && cached.expires > Date.now()) return cached.tracks;
  if (!supabase) return [];

  const { data: artists, error: aErr } = await supabase
    .schema('kokomusic')
    .from('koko_profiles')
    .select('artist_id')
    .eq('is_artist', true)
    .not('artist_id', 'is', null);
  if (aErr) throw aErr;

  const artistIds = (artists ?? []).map((a: any) => Number(a.artist_id)).filter(Boolean);
  let tracks: TrackMetadata[] = [];
  if (artistIds.length > 0) {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .select('itunes_id, title, artist, artist_id, album, cover_url, duration_ms, genre, release_date')
      .in('artist_id', artistIds);
    if (error) throw error;
    tracks = (data ?? []).map((row: any) => ({
      id: String(row.itunes_id),
      itunesId: Number(row.itunes_id),
      artistId: Number(row.artist_id),
      title: row.title || '',
      artist: row.artist || '',
      album: row.album || '',
      cover: row.cover_url || '',
      duration: Number(row.duration_ms) || 180_000,
      genre: row.genre || 'Otros',
      releaseDate: row.release_date || null,
      popularity: 50,
      preview_url: null,
    }));
  }

  cached = { tracks, expires: Date.now() + TTL_MS };
  return tracks;
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Canciones del catálogo Koko que casan con la búsqueda: todas las palabras de
 * la query deben aparecer en título/artista/álbum. Título exacto primero.
 */
export function matchKokoArtistTracks(query: string, tracks: TrackMetadata[], limit = 5): TrackMetadata[] {
  const q = normalize(query);
  const tokens = q.split(' ').filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];

  return tracks
    .map((t) => {
      const title = normalize(t.title);
      const haystack = `${title} ${normalize(t.artist)} ${normalize(t.album)}`;
      if (!tokens.every((tok) => haystack.includes(tok))) return null;
      const score = (title === q ? 3 : 0) + (title.startsWith(q) ? 2 : 0) + (normalize(t.artist) === q ? 1 : 0);
      return { t, score };
    })
    .filter((x): x is { t: TrackMetadata; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

/**
 * Agrupa géneros heterogéneos (los de iTunes/Deezer vs. la lista del Panel de
 * Artista) en familias comparables. null = sin familia (p. ej. "Otros").
 */
export function genreFamily(genre: string | null | undefined): string | null {
  const g = normalize(genre || '');
  if (!g) return null;
  if (/urban|latin|reggaet|bachata|salsa|cumbia|dembow/.test(g)) return 'latin';
  if (/trap|hip hop|hiphop|rap|drill|phonk/.test(g)) return 'hiphop';
  if (/r b|rnb|soul/.test(g)) return 'rnb';
  if (/electr|dance|house|techno|edm/.test(g)) return 'electronic';
  if (/rock|metal|punk|alternativ|indie/.test(g)) return 'rock';
  if (/pop/.test(g)) return 'pop';
  return null;
}

// ── Perfil público de artista Koko ───────────────────────────────────────────
// GET /api/artist/:id tiraba siempre por iTunes/YouTube (getArtistInfo), que no
// conocen a los artistas de KokoMusic: para cualquier otro usuario el perfil
// acababa en 404 (el propio artista solo lo veía porque su pestaña usa
// /artist/tracks/mine). Esto lo resuelve contra koko_profiles + tracks_meta.

interface KokoArtistRow {
  artist_id: number;
  display_name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
}

let artistsCache: { rows: KokoArtistRow[]; expires: number } | null = null;

async function getKokoArtistRows(): Promise<KokoArtistRow[]> {
  if (artistsCache && artistsCache.expires > Date.now()) return artistsCache.rows;
  if (!supabase) return [];
  const { data, error } = await supabase
    .schema('kokomusic')
    .from('koko_profiles')
    .select('artist_id, display_name, username, bio, avatar_url')
    .eq('is_artist', true)
    .not('artist_id', 'is', null);
  if (error) throw error;
  const rows = (data ?? []).map((r: any) => ({ ...r, artist_id: Number(r.artist_id) })) as KokoArtistRow[];
  artistsCache = { rows, expires: Date.now() + TTL_MS };
  return rows;
}

/** Mismo hash que artistService.hashStringToInteger (copiado para no crear un import circular). */
function hashName(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Devuelve el perfil de un artista Koko si `identifier` lo identifica: su
 * artist_id real, el hash de su nombre (así enlazan las subidas de biblioteca
 * `custom_…`) o su nombre. null si no es un artista Koko.
 */
export async function getKokoArtistProfile(identifier: number | string): Promise<ArtistInfo | null> {
  const rows = await getKokoArtistRows();
  if (rows.length === 0) return null;

  const nameOf = (r: KokoArtistRow) => r.display_name || r.username || 'Artista Koko';
  let row: KokoArtistRow | undefined;
  if (typeof identifier === 'number') {
    row = rows.find((r) => r.artist_id === identifier) || rows.find((r) => hashName(nameOf(r)) === identifier);
  } else {
    const wanted = normalize(identifier);
    row = rows.find((r) => normalize(nameOf(r)) === wanted || (!!r.username && normalize(r.username) === wanted));
  }
  if (!row) return null;

  const name = nameOf(row);
  const catalog = await getKokoArtistTracks();
  const topTracks = catalog
    .filter((t) => t.artistId === row!.artist_id)
    .sort((a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')));

  const genreCounts = new Map<string, number>();
  for (const t of topTracks) genreCounts.set(t.genre, (genreCounts.get(t.genre) || 0) + 1);
  const genre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Artista Koko';

  return {
    itunesArtistId: row.artist_id,
    name,
    bio: row.bio || '',
    image: row.avatar_url || topTracks[0]?.cover || '',
    genre,
    topTracks,
    albums: [],
    isVerified: false,
  };
}

export function invalidateKokoArtistProfiles(): void {
  artistsCache = null;
}
