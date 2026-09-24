/**
 * Señales para KokoMix y Descubrir, todas desde fuentes persistentes (Supabase
 * + cachés compartidas) — nunca del JSON local de historial, que en Render se
 * borra en cada reinicio.
 *
 *   - Historial real del usuario (user_history) → artistas conocidos, lo
 *     escuchado hace poco y lo que le gustaba y lleva tiempo sin oír.
 *   - Artistas similares (Last.fm artist.getsimilar), cacheados 7 días y
 *     compartidos entre usuarios.
 *   - "Amigos con gustos parecidos": otros perfiles de gusto de la app con
 *     artistas/géneros en común (con ~25 usuarios es la señal más fiable).
 */

import { cache } from './cacheService';
import { supabase } from './supabaseService';
import { getHistoryForUser, type HistoryEntry } from './historyService';
import { getArtistTopTracksFromItunes, type TrackMetadata } from './metadataService';
import type { TasteProfile } from './tasteProfileBuilder';

const LFM_KEY = process.env.LASTFM_KEY || '';
const RECENT_DAYS = 3;

export function normArtist(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}

/** "Bad Bunny feat. Jhayco & Tainy" → ["Bad Bunny", "Jhayco", "Tainy"] */
function splitArtists(name: string): string[] {
  return (name || '')
    .split(/,|&|\s+feat\.?\s+|\s+ft\.?\s+|\s+x\s+|\s+y\s+|\s+with\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface UserSignals {
  history: HistoryEntry[];
  /** Artistas (normalizados, incluidos colaboradores) que el usuario ya ha escuchado. */
  knownArtists: Set<string>;
  /** Escuchado en los últimos RECENT_DAYS días — no se recomienda. */
  recentTrackIds: Set<string>;
  playedTrackIds: Set<string>;
  /** Artistas favoritos por peso, del perfil de gusto o, si no hay, del historial. */
  topArtists: { name: string; weight: number }[];
}

export async function loadUserSignals(userId: string, profile: TasteProfile | null): Promise<UserSignals> {
  const history = await getHistoryForUser(userId).catch(() => [] as HistoryEntry[]);
  const knownArtists = new Set<string>();
  const recentTrackIds = new Set<string>();
  const playedTrackIds = new Set<string>();
  const recentCutoff = Date.now() - RECENT_DAYS * 86400_000;
  const playsByArtist = new Map<string, { name: string; plays: number }>();

  for (const h of history) {
    if (!h.trackId) continue;
    playedTrackIds.add(h.trackId);
    if (h.lastPlayed && new Date(h.lastPlayed).getTime() > recentCutoff) recentTrackIds.add(h.trackId);
    for (const a of splitArtists(h.artist)) {
      const key = normArtist(a);
      if (!key) continue;
      knownArtists.add(key);
      const entry = playsByArtist.get(key) ?? { name: a, plays: 0 };
      entry.plays += h.playCount || 1;
      playsByArtist.set(key, entry);
    }
  }

  let topArtists = (profile?.topArtists ?? [])
    .filter((a) => a.name && a.name !== 'Unknown')
    .map((a) => ({ name: a.name, weight: a.weight }));
  if (topArtists.length === 0) {
    const total = [...playsByArtist.values()].reduce((s, a) => s + a.plays, 0) || 1;
    topArtists = [...playsByArtist.values()]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 20)
      .map((a) => ({ name: a.name, weight: a.plays / total }));
  }
  for (const a of topArtists) for (const part of splitArtists(a.name)) knownArtists.add(normArtist(part));

  return { history, knownArtists, recentTrackIds, playedTrackIds, topArtists };
}

// ── Last.fm: artistas similares ───────────────────────────────────────────────

export async function getSimilarArtists(artist: string): Promise<{ name: string; match: number }[]> {
  if (!LFM_KEY || !artist) return [];
  const key = `lfm-similar:${normArtist(artist)}`;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${LFM_KEY}&format=json&limit=20&autocorrect=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const list = ((data?.similarartists?.artist ?? []) as any[])
      .map((a) => ({ name: String(a.name || ''), match: Number(a.match) || 0 }))
      .filter((a) => a.name);
    cache.setex(key, list.length > 0 ? 7 * 86400 : 6 * 3600, JSON.stringify(list));
    return list;
  } catch {
    return [];
  }
}

/**
 * Artistas parecidos a los favoritos del usuario que él NO conoce todavía,
 * puntuados por similitud × cuánto le gusta el artista semilla.
 */
export async function getRelatedUnknownArtists(signals: UserSignals, seeds = 6, limit = 20): Promise<{ name: string; score: number }[]> {
  const seedArtists = signals.topArtists.slice(0, seeds);
  const lists = await Promise.all(seedArtists.map((a) => getSimilarArtists(a.name)));
  const scores = new Map<string, { name: string; score: number }>();
  lists.forEach((list, i) => {
    const seedWeight = seedArtists[i].weight || 0.05;
    for (const s of list) {
      const key = normArtist(s.name);
      if (!key || signals.knownArtists.has(key)) continue;
      const entry = scores.get(key) ?? { name: s.name, score: 0 };
      entry.score += s.match * (0.5 + seedWeight);
      scores.set(key, entry);
    }
  });
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Amigos con gustos parecidos ───────────────────────────────────────────────

async function loadAllTasteProfiles(): Promise<TasteProfile[]> {
  const key = 'all-taste-profiles';
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  if (!supabase) return [];
  const { data, error } = await supabase.schema('kokomusic').from('taste_profiles').select('profile_json').limit(200);
  if (error || !data) return [];
  const profiles = (data as any[]).map((r) => r.profile_json as TasteProfile).filter(Boolean);
  cache.setex(key, 600, JSON.stringify(profiles));
  return profiles;
}

/**
 * Artistas que escuchan los usuarios con gustos más parecidos (artistas y
 * géneros en común) y que este usuario aún no conoce.
 */
export async function getNeighborArtists(userId: string, profile: TasteProfile | null, signals: UserSignals, limit = 15): Promise<{ name: string; score: number }[]> {
  if (!profile) return [];
  const others = (await loadAllTasteProfiles()).filter((p) => p.userId !== userId);
  const myArtists = new Map(profile.topArtists.map((a) => [normArtist(a.name), a.weight]));

  const neighbors = others
    .map((p) => {
      let sim = 0;
      for (const a of p.topArtists ?? []) sim += Math.min(a.weight, myArtists.get(normArtist(a.name)) ?? 0);
      for (const [g, w] of Object.entries(p.genreAffinity ?? {})) {
        if (g !== 'Otros') sim += 0.3 * Math.min(w, profile.genreAffinity[g] ?? 0);
      }
      return { p, sim };
    })
    .filter((n) => n.sim > 0.02)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);

  const scores = new Map<string, { name: string; score: number }>();
  for (const { p, sim } of neighbors) {
    for (const a of p.topArtists ?? []) {
      const key = normArtist(a.name);
      if (!key || a.name === 'Unknown' || signals.knownArtists.has(key)) continue;
      const entry = scores.get(key) ?? { name: a.name, score: 0 };
      entry.score += sim * a.weight;
      scores.set(key, entry);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

// ── Canciones de un conjunto de artistas ──────────────────────────────────────

function rowToTrack(row: any): TrackMetadata {
  return {
    id: String(row.itunes_id),
    itunesId: Number(row.itunes_id),
    artistId: Number(row.artist_id) || 0,
    title: row.title || '',
    artist: row.artist || '',
    album: row.album || '',
    cover: row.cover_url || '',
    duration: Number(row.duration_ms) || 180_000,
    genre: row.genre || 'Otros',
    releaseDate: row.release_date || null,
    popularity: 50,
    preview_url: null,
  };
}

/**
 * Canciones por artista (clave: nombre normalizado). Primero tracks_meta (una
 * sola consulta); los artistas con menos de `perArtist` canciones en BD se
 * completan con iTunes (cacheado 7 días y guardado en BD para la próxima vez).
 */
export async function getTracksForArtists(names: string[], perArtist: number): Promise<Map<string, TrackMetadata[]>> {
  const result = new Map<string, TrackMetadata[]>();
  const unique = [...new Map(names.filter(Boolean).map((n) => [normArtist(n), n])).values()];
  if (unique.length === 0) return result;

  if (supabase) {
    const { data } = await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .select('itunes_id, title, artist, artist_id, album, cover_url, duration_ms, genre, release_date')
      .in('artist', unique)
      .not('cover_url', 'is', null)
      .neq('cover_url', '')
      .limit(unique.length * 12);
    for (const row of (data ?? []) as any[]) {
      const key = normArtist(row.artist);
      const list = result.get(key) ?? [];
      list.push(rowToTrack(row));
      result.set(key, list);
    }
  }

  const missing = unique.filter((n) => (result.get(normArtist(n))?.length ?? 0) < perArtist);
  for (let i = 0; i < missing.length; i += 4) {
    const batch = missing.slice(i, i + 4);
    const fetched = await Promise.all(batch.map((n) => getArtistTopTracksFromItunes(n, perArtist + 3)));
    batch.forEach((n, idx) => {
      const key = normArtist(n);
      const existing = result.get(key) ?? [];
      const ids = new Set(existing.map((t) => t.id));
      result.set(key, [...existing, ...fetched[idx].filter((t) => !ids.has(t.id))]);
    });
  }
  return result;
}

/**
 * Mezcla varias listas respetando proporciones (peso relativo), para que
 * ninguna fuente acapare la cabeza del ranking.
 */
export function interleaveByWeight<T>(buckets: { items: T[]; weight: number }[]): T[] {
  const state = buckets.filter((b) => b.items.length > 0 && b.weight > 0).map((b) => ({ ...b, taken: 0 }));
  const out: T[] = [];
  while (state.some((b) => b.taken < b.items.length)) {
    const next = state
      .filter((b) => b.taken < b.items.length)
      .sort((a, b) => a.taken / a.weight - b.taken / b.weight)[0];
    out.push(next.items[next.taken++]);
  }
  return out;
}
