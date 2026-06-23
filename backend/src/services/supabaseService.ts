/**
 * Supabase Client — KokoMusic
 * Usa service_role key para bypass de RLS en operaciones de escritura.
 * Las lecturas RLS están configuradas para usuarios autenticados (Koko accounts).
 */

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[Supabase] ⚠️  SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados. El caché L2 estará desactivado.');
}

export const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
      realtime: { transport: ws as any },
    })
  : null;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface TrackRow {
  itunes_id:   number;
  title:       string;
  artist:      string;
  artist_id:   number;
  album:       string | null;
  cover_url:   string | null;
  duration_ms: number | null;
  genre:       string | null;
  release_date: string | null;
}

export interface ArtistRow {
  itunes_artist_id: number;
  name:             string;
  genre:            string | null;
  bio:              string | null;
  image_url:        string | null;
  updated_at:       string;
}

export interface YouTubeResolutionRow {
  itunes_id:   number;
  youtube_id:  string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Upsert de un track (o varios) en kokomusic.tracks_meta */
export async function upsertTracks(tracks: TrackRow[]): Promise<void> {
  if (!supabase || tracks.length === 0) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('tracks_meta')
    .upsert(tracks, { onConflict: 'itunes_id', ignoreDuplicates: false });
  if (error) console.error('[Supabase] Error upserting tracks:', error.message);
}

/** Busca un track por iTunesId en L2 */
export async function getTrackFromDB(itunesId: number): Promise<TrackRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .schema('kokomusic')
    .from('tracks_meta')
    .select('*')
    .eq('itunes_id', itunesId)
    .single();
  if (error) return null;
  return data as TrackRow;
}

/** Upsert de un artista en kokomusic.artists_meta */
export async function upsertArtist(artist: ArtistRow): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('artists_meta')
    .upsert({ ...artist, updated_at: new Date().toISOString() }, { onConflict: 'itunes_artist_id' });
  if (error) console.error('[Supabase] Error upserting artist:', error.message);
}

/** Busca un artista por iTunesArtistId en L2. Retorna null si tiene > 30 días. */
export async function getArtistFromDB(artistId: number): Promise<ArtistRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .schema('kokomusic')
    .from('artists_meta')
    .select('*')
    .eq('itunes_artist_id', artistId)
    .single();
  if (error || !data) return null;

  // TTL soft de 30 días para metadata de artistas
  const updatedAt = new Date((data as ArtistRow).updated_at).getTime();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - updatedAt > thirtyDaysMs) return null;

  return data as ArtistRow;
}

/** Guarda la resolución de YouTube para un track de iTunes */
export async function upsertYouTubeResolution(itunesId: number, youtubeId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('youtube_resolutions')
    .upsert({ itunes_id: itunesId, youtube_id: youtubeId }, { onConflict: 'itunes_id' });
  if (error) console.error('[Supabase] Error upserting YouTube resolution:', error.message);
}

/** Obtiene la resolución de YouTube para un iTunesId */
export async function getYouTubeResolution(itunesId: number): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .schema('kokomusic')
    .from('youtube_resolutions')
    .select('youtube_id')
    .eq('itunes_id', itunesId)
    .single();
  if (error || !data) return null;
  return (data as YouTubeResolutionRow).youtube_id;
}
