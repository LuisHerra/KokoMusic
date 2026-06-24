/**
 * historyService.ts
 *
 * Hybrid listening history store:
 * - PRIMARY write: Supabase kokomusic.play_events (source of truth, cross-device/cross-user)
 * - SECONDARY write: local JSON cache (fast reads for own stats, offline resilience)
 *
 * Read strategy:
 * - Own stats (/history/stats):  local JSON → fast, no Supabase latency
 * - Friend stats (profile/:id):  Supabase → only way to read cross-user data
 *
 * Play event lifecycle:
 *   1. logTrackPlay() → Supabase INSERT (seconds=0) + JSON update
 *   2. saveSessionMinutes() → Supabase UPDATE matching event by (userId, deviceId, trackId, window) + JSON update
 */

import fs from 'fs';
import path from 'path';
import { searchInvidious } from './invidiousService';
import { TrackMetadata } from './spotifyService';
import { supabase } from './supabaseService';

const HISTORY_FILE = path.join(__dirname, '../../data/user_history.json');

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  trackId: string;
  title: string;
  artist: string;
  cover: string;
  playCount: number;
  lastPlayed: string;
  plays?: string[];
  minutesBySession?: { date: string; seconds: number }[];
  userId?: string;
}

export interface SessionEntry {
  trackId: string;
  seconds: number;
  title: string;
  artist: string;
  cover: string;
  /** ISO timestamp when the play started — sent from client for accurate window matching */
  playedAt?: string;
}

export interface CloudStats {
  totalPlays: number;
  totalSeconds: number;
  topTracks: {
    trackId: string;
    title: string;
    artist: string;
    cover: string;
    plays: number;
    seconds: number;
  }[];
  topArtists: { name: string; plays: number; cover: string }[];
  favoriteGenre: string;
}

// ── Local JSON helpers ───────────────────────────────────────────────────────

function ensureDir() {
  const dir = path.dirname(HISTORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function readHistory(): HistoryEntry[] {
  ensureDir();
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Resolves the history log for a user.
 * Attempts to load from Supabase first (to support cross-device/social/fresh login).
 * Falls back to local JSON cache if Supabase is unavailable or returns no rows.
 */
export async function getHistoryForUser(
  userId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<HistoryEntry[]> {
  if (!userId) {
    // If no userId, return full local history (legacy/anonymous device behavior)
    return readHistory();
  }

  if (supabase) {
    try {
      const query = supabase
        .schema('kokomusic')
        .from('play_events')
        .select('track_id, title, artist, cover, played_at, seconds_listened')
        .eq('user_id', userId);

      if (startDate && startDate.getTime() > 0) {
        query.gte('played_at', startDate.toISOString());
      }
      if (endDate) {
        query.lte('played_at', endDate.toISOString());
      }

      // Order by played_at descending and limit to protect memory/performance (5000 limit)
      const { data, error } = await query
        .order('played_at', { ascending: false })
        .limit(5000);

      if (!error && data && data.length > 0) {
        const historyMap: Record<string, HistoryEntry> = {};

        for (const row of data) {
          const tid = row.track_id as string;
          const playedAt = row.played_at as string;
          const seconds = (row.seconds_listened as number) || 0;

          if (!historyMap[tid]) {
            historyMap[tid] = {
              trackId: tid,
              title: row.title as string,
              artist: row.artist as string,
              cover: (row.cover as string) || '',
              playCount: 0,
              lastPlayed: playedAt,
              plays: [],
              minutesBySession: [],
              userId
            };
          }

          historyMap[tid].playCount++;
          (historyMap[tid].plays ??= []).push(playedAt);

          if (seconds > 0) {
            (historyMap[tid].minutesBySession ??= []).push({
              date: playedAt,
              seconds
            });
          }

          if (new Date(playedAt).getTime() > new Date(historyMap[tid].lastPlayed).getTime()) {
            historyMap[tid].lastPlayed = playedAt;
          }
        }

        return Object.values(historyMap);
      }
    } catch (err) {
      console.error('[History] Error loading user history from Supabase, falling back to local JSON:', err);
    }
  }

  // Fallback to local JSON
  return readHistory().filter((h) => h.userId === userId);
}


function writeHistory(history: HistoryEntry[]) {
  ensureDir();
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (err) {
    console.error('[History] Error escribiendo JSON:', err);
  }
}

function updateLocalCache(
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string },
  now: string,
  userId?: string
) {
  const history = readHistory();
  const existing = history.find(
    (h) => h.trackId === trackId && h.userId === userId
  );
  if (existing) {
    existing.playCount += 1;
    existing.lastPlayed = now;
    (existing.plays ??= []).push(now);
  } else {
    history.push({
      trackId,
      title: trackInfo.title,
      artist: trackInfo.artist,
      cover: trackInfo.cover,
      playCount: 1,
      lastPlayed: now,
      plays: [now],
      userId,
    });
  }
  writeHistory(history);
}

function updateLocalSessionCache(
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string },
  seconds: number,
  now: string,
  userId?: string
) {
  const history = readHistory();
  const existing = history.find(
    (h) => h.trackId === trackId && h.userId === userId
  );
  const record = { date: now, seconds: Math.round(seconds) };
  if (existing) {
    (existing.minutesBySession ??= []).push(record);
  } else {
    history.push({
      trackId,
      title: trackInfo.title,
      artist: trackInfo.artist,
      cover: trackInfo.cover,
      playCount: 0,
      lastPlayed: now,
      plays: [],
      minutesBySession: [record],
      userId,
    });
  }
  writeHistory(history);
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

/** Insert a new play event. Returns the inserted row id so we can update seconds later. */
async function insertPlayEvent(
  userId: string,
  deviceId: string,
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string },
  playedAt: string
): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('play_events')
      .insert({
        user_id: userId,
        device_id: deviceId,
        track_id: trackId,
        title: trackInfo.title,
        artist: trackInfo.artist,
        cover: trackInfo.cover || '',
        played_at: playedAt,
        seconds_listened: 0,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[History] Supabase insert error:', error.message);
      return null;
    }
    return (data as any)?.id ?? null;
  } catch (err) {
    console.error('[History] Unexpected Supabase insert error:', err);
    return null;
  }
}

/**
 * Update seconds_listened on the most recent play_event for this user+device+track
 * within a 2-hour window before `playedAt`.
 */
async function updateEventSeconds(
  userId: string,
  deviceId: string,
  trackId: string,
  playedAt: string,
  seconds: number
): Promise<void> {
  if (!supabase || seconds < 5) return;
  try {
    const windowStart = new Date(
      new Date(playedAt).getTime() - 2 * 60 * 60 * 1000
    ).toISOString();

    // Find the most recent matching event in the window
    const { data: events } = await supabase
      .schema('kokomusic')
      .from('play_events')
      .select('id')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .eq('track_id', trackId)
      .gte('played_at', windowStart)
      .lte('played_at', playedAt)
      .order('played_at', { ascending: false })
      .limit(1);

    if (!events || events.length === 0) return;

    const eventId = (events[0] as any).id;
    await supabase
      .schema('kokomusic')
      .from('play_events')
      .update({ seconds_listened: Math.round(seconds) })
      .eq('id', eventId);
  } catch (err) {
    console.error('[History] Error updating seconds_listened:', err);
  }
}

// ── Public write functions ───────────────────────────────────────────────────

/**
 * Log a track play (called when progress >= 10s).
 * Writes to Supabase first (primary), then updates local JSON cache.
 */
export function logTrackPlay(
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string },
  userId?: string,
  deviceId?: string
): HistoryEntry {
  const now = new Date().toISOString();
  const history = readHistory();
  const existing = history.find(
    (h) => h.trackId === trackId && h.userId === userId
  );

  let entry: HistoryEntry;
  if (existing) {
    existing.playCount += 1;
    existing.lastPlayed = now;
    (existing.plays ??= []).push(now);
    entry = existing;
  } else {
    entry = {
      trackId,
      title: trackInfo.title,
      artist: trackInfo.artist,
      cover: trackInfo.cover,
      playCount: 1,
      lastPlayed: now,
      plays: [now],
      userId,
    };
    history.push(entry);
  }
  writeHistory(history);

  // Supabase write (non-blocking — fire and forget)
  if (userId) {
    insertPlayEvent(
      userId,
      deviceId || 'unknown',
      trackId,
      trackInfo,
      now
    ).catch(() => {});
  }

  return entry;
}

/**
 * Save accumulated listening seconds for a session.
 * Called on app exit / page visibility=hidden via sendBeacon.
 * Updates Supabase play_events with real seconds_listened.
 */
export async function saveSessionMinutes(
  sessions: SessionEntry[],
  userId?: string,
  deviceId?: string
): Promise<void> {
  const now = new Date().toISOString();

  for (const session of sessions) {
    if (session.seconds < 5) continue;

    const roundedSecs = Math.round(session.seconds);
    const playedAt = session.playedAt ?? now;

    // 1. Update local JSON cache
    updateLocalSessionCache(
      session.trackId,
      { title: session.title, artist: session.artist, cover: session.cover },
      roundedSecs,
      now,
      userId
    );

    // 2. Update Supabase (find matching play event and write real seconds)
    if (userId) {
      await updateEventSeconds(
        userId,
        deviceId || 'unknown',
        session.trackId,
        playedAt,
        roundedSecs
      );
    }
  }
}

// ── Cloud stats read (cross-user) ─────────────────────────────────────────────

/**
 * Query Supabase for listening stats for a given userId.
 * Used for friend profiles — works cross-device and cross-user.
 * Optional date range filtering.
 */
export async function getUserStatsFromCloud(
  userId: string,
  startDate?: Date,
  endDate?: Date
): Promise<CloudStats | null> {
  if (!supabase) return null;

  try {
    // Limit to last 365 days by default to keep query fast
    const effectiveEnd = endDate ?? new Date();
    const effectiveStart =
      startDate ??
      new Date(effectiveEnd.getTime() - 365 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .schema('kokomusic')
      .from('play_events')
      .select('track_id, title, artist, cover, seconds_listened')
      .eq('user_id', userId)
      .gte('played_at', effectiveStart.toISOString())
      .lte('played_at', effectiveEnd.toISOString())
      .limit(2000); // cap to avoid expensive full-table scans

    if (error || !data || data.length === 0) return null;

    // Aggregate in memory (fast — max 2000 rows)
    const trackMap: Record<
      string,
      { title: string; artist: string; cover: string; plays: number; seconds: number }
    > = {};
    const artistMap: Record<string, { plays: number; cover: string }> = {};
    let totalSeconds = 0;

    for (const row of data) {
      const tid = row.track_id as string;
      const secs = (row.seconds_listened as number) || 0;
      totalSeconds += secs;

      if (!trackMap[tid]) {
        trackMap[tid] = {
          title: row.title as string,
          artist: row.artist as string,
          cover: (row.cover as string) || '',
          plays: 0,
          seconds: 0,
        };
      }
      trackMap[tid].plays++;
      trackMap[tid].seconds += secs;

      const artistName = row.artist as string;
      if (!artistMap[artistName]) {
        artistMap[artistName] = { plays: 0, cover: (row.cover as string) || '' };
      }
      artistMap[artistName].plays++;
    }

    const topTracks = Object.entries(trackMap)
      .sort((a, b) => b[1].plays - a[1].plays)
      .slice(0, 10)
      .map(([trackId, info]) => ({ trackId, ...info }));

    const topArtists = Object.entries(artistMap)
      .sort((a, b) => b[1].plays - a[1].plays)
      .slice(0, 10)
      .map(([name, info]) => ({ name, ...info }));

    // Resolve top genre from tracks_meta (best-effort)
    let favoriteGenre = 'Otros';
    if (topTracks.length > 0) {
      const itunesId = parseInt(topTracks[0].trackId, 10);
      if (!isNaN(itunesId)) {
        const { data: meta } = await supabase
          .schema('kokomusic')
          .from('tracks_meta')
          .select('genre')
          .eq('itunes_id', itunesId)
          .maybeSingle();
        if (meta && (meta as any).genre) {
          favoriteGenre = (meta as any).genre as string;
        }
      }
    }

    return { totalPlays: data.length, totalSeconds, topTracks, topArtists, favoriteGenre };
  } catch (err) {
    console.error('[History] getUserStatsFromCloud error:', err);
    return null;
  }
}

// ── Recommendations ──────────────────────────────────────────────────────────

export async function getRecommendations(limit = 10, userId?: string, mood?: string): Promise<TrackMetadata[]> {
  const history = readHistory().filter(h => !userId || h.userId === userId);

  // Helper to guess genre
  const guessGenre = (title: string, artist: string): string => {
    const normArtist = artist.toLowerCase();
    const normTitle = title.toLowerCase();
    if (
      normArtist.includes('bunny') || normArtist.includes('towers') || 
      normArtist.includes('carrion') || normArtist.includes('ozuna') || 
      normArtist.includes('jhay') || normArtist.includes('karol g') || 
      normArtist.includes('reggaeton') || normArtist.includes('reggaetón') ||
      normArtist.includes('urbano') || normTitle.includes('reggaeton')
    ) {
      return 'Urban/Latino';
    }
    if (
      normArtist.includes('weeknd') || normArtist.includes('mika') || 
      normArtist.includes('jackson') || normArtist.includes('shakira') || 
      normArtist.includes('pop') || normTitle.includes('pop')
    ) {
      return 'Pop';
    }
    if (
      normArtist.includes('secretos') || normArtist.includes('rock') || 
      normArtist.includes('metal') || normArtist.includes('punk') ||
      normTitle.includes('rock') || normTitle.includes('metal')
    ) {
      return 'Rock/Alternative';
    }
    if (
      normArtist.includes('rap') || normArtist.includes('hip hop') || 
      normArtist.includes('hip-hop') || normTitle.includes('rap')
    ) {
      return 'Hip-Hop/Rap';
    }
    if (
      normArtist.includes('classical') || normArtist.includes('clásico') ||
      normArtist.includes('piano') || normArtist.includes('orchestra')
    ) {
      return 'Clásico';
    }
    return 'Otros';
  };

  // Standard mood queries fallback
  const moodKeywords: Record<string, string[]> = {
    workout: ['workout hits', 'gym motivation', 'cardio fitness electro'],
    chill: ['chill vibes lofi', 'relaxing r&b', 'chill acoustic lounge'],
    study: ['lofi study beats', 'ambient study background', 'piano concentration'],
    party: ['party reggaeton hits', 'dance party club anthems', 'party pop hits'],
    rock: ['rock classics', 'alternative rock hits', 'hard rock'],
    sad: ['sad acoustic songs', 'emotional pop ballads', 'melancholic tracks'],
    happy: ['feel good pop', 'happy summer hits', 'uplifting upbeat songs'],
    latin: ['reggaeton 2024 hits', 'latin pop urbano', 'salsa bachata dance'],
    electronic: ['electronic dance music EDM', 'deep house mix', 'techno beats'],
    hiphop: ['hip hop rap hits', 'trap vibes playlist', 'lofi hip hop beats'],
    classical: ['classical piano masterpieces', 'relaxing violin classical', 'orchestral symphony'],
    focus: ['deep focus concentration', 'ambient relaxation study', 'binaural study beats']
  };

  let searchTerms: string[] = [];

  if (history.length > 0) {
    // Determine top artists and genres
    const artistCounts: Record<string, number> = {};
    const genreCounts: Record<string, number> = {};
    
    history.forEach((h) => {
      if (h.artist) {
        artistCounts[h.artist] = (artistCounts[h.artist] || 0) + h.playCount;
        const g = guessGenre(h.title, h.artist);
        genreCounts[g] = (genreCounts[g] || 0) + h.playCount;
      }
    });

    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a);

    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g);

    if (mood && moodKeywords[mood.toLowerCase()]) {
      const normalizedMood = mood.toLowerCase();
      const fallbacks = moodKeywords[normalizedMood];
      
      // Personalization logic: Combine top artists with the mood context
      if (topArtists.length > 0) {
        const topArtist = topArtists[0];
        // e.g. "Bad Bunny party mix" or "Linkin Park rock motivation"
        if (normalizedMood === 'workout') searchTerms.push(`${topArtist} upbeat gym`);
        else if (normalizedMood === 'chill') searchTerms.push(`${topArtist} chill acoustic lofi`);
        else if (normalizedMood === 'party') searchTerms.push(`${topArtist} live party mix`);
        else if (normalizedMood === 'sad') searchTerms.push(`${topArtist} slow acoustic sad`);
        else if (normalizedMood === 'happy') searchTerms.push(`${topArtist} positive happy hits`);
        else if (normalizedMood === 'latin') searchTerms.push(`${topArtist} latin reggaeton`);
        else if (normalizedMood === 'rock') searchTerms.push(`${topArtist} rock live alternative`);
        else if (normalizedMood === 'hiphop') searchTerms.push(`${topArtist} rap hiphop playlist`);
        else searchTerms.push(`${topArtist} ${fallbacks[0]}`);
      }

      // Add standard fallback queries for the mood
      searchTerms.push(...fallbacks);
    } else {
      // General recommendations (no mood requested)
      if (topArtists.length > 0) {
        const pickArtist = topArtists[Math.floor(Math.random() * topArtists.length)];
        searchTerms.push(`${pickArtist} songs`);
      }
      searchTerms.push('lofi chill beats');
    }
  } else {
    // No history fallback
    if (mood && moodKeywords[mood.toLowerCase()]) {
      searchTerms.push(...moodKeywords[mood.toLowerCase()]);
    } else {
      searchTerms.push('pop music hits');
    }
  }

  // Pick one term randomly to provide variety on refresh
  const query = searchTerms[Math.floor(Math.random() * searchTerms.length)];

  try {
    const videos = await searchInvidious(query, limit * 3);
    const seen = new Set(history.map((h) => h.trackId));
    const pool = videos.filter((v) => !seen.has(v.videoId));
    const source = pool.length > 3 ? pool : videos;
    return source
      .sort(() => 0.5 - Math.random())
      .slice(0, limit)
      .map((v) => ({
        id: v.videoId,
        title: v.title,
        artist: v.author?.name ?? 'Desconocido',
        album: mood ? `Mood: ${mood.charAt(0).toUpperCase() + mood.slice(1)}` : 'YouTube Recommendations',
        cover: v.thumbnail || '',
        duration: (v.duration?.seconds ?? 0) * 1000,
        popularity: v.views ?? 0,
        preview_url: null,
      }));
  } catch {
    return [];
  }
}

/**
 * Migration script: Backfills any plays found in user_history.json to Supabase.
 * Checks for duplicates before inserting to allow running on application startup.
 */
export async function backfillLocalHistoryToCloud(): Promise<{ success: boolean; inserted: number }> {
  if (!supabase) {
    return { success: false, inserted: 0 };
  }

  try {
    const history = readHistory();
    if (history.length === 0) {
      return { success: true, inserted: 0 };
    }

    // Filter to entries that have a userId
    const validEntries = history.filter((h) => h.userId);
    if (validEntries.length === 0) {
      return { success: true, inserted: 0 };
    }

    // Get unique userIds represented in the local file
    const userIds = Array.from(new Set(validEntries.map((h) => h.userId!)));
    let totalInserted = 0;

    for (const userId of userIds) {
      // 1. Fetch existing plays for this user from Supabase to prevent duplicates
      const { data: existingEvents, error } = await supabase
        .schema('kokomusic')
        .from('play_events')
        .select('played_at')
        .eq('user_id', userId);

      if (error) {
        console.error(`[Backfill] Error fetching existing plays for ${userId}:`, error.message);
        continue;
      }

      // Set of ISO strings or date times
      const existingPlayTimes = new Set(
        (existingEvents || []).map((e: any) => new Date(e.played_at).toISOString())
      );

      const userEntries = validEntries.filter((h) => h.userId === userId);
      const toInsert: any[] = [];

      for (const entry of userEntries) {
        const plays = entry.plays || (entry.lastPlayed ? [entry.lastPlayed] : []);
        
        for (const p of plays) {
          const playedAtISO = new Date(p).toISOString();
          
          if (!existingPlayTimes.has(playedAtISO)) {
            // Find if there is session minutes info matching this date/time window
            let seconds = 0;
            if (entry.minutesBySession && entry.minutesBySession.length > 0) {
              // Try to find a session close to this play time (within 1 hour)
              const playTimeMs = new Date(p).getTime();
              const matchingSession = entry.minutesBySession.find((s) => {
                const sessionTimeMs = new Date(s.date).getTime();
                return Math.abs(sessionTimeMs - playTimeMs) < 60 * 60 * 1000;
              });
              if (matchingSession) {
                seconds = matchingSession.seconds;
              }
            }

            toInsert.push({
              user_id: userId,
              device_id: 'local_backfill',
              track_id: entry.trackId,
              title: entry.title,
              artist: entry.artist,
              cover: entry.cover || '',
              played_at: playedAtISO,
              seconds_listened: seconds,
            });
          }
        }
      }

      if (toInsert.length > 0) {
        console.log(`[Backfill] Inserting ${toInsert.length} historic plays for user ${userId} into Supabase...`);
        
        // Supabase allows bulk inserts
        // Insert in batches of 200 to be safe and avoid payload limits
        const batchSize = 200;
        for (let i = 0; i < toInsert.length; i += batchSize) {
          const batch = toInsert.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .schema('kokomusic')
            .from('play_events')
            .insert(batch);

          if (insertError) {
            console.error('[Backfill] Bulk insert error:', insertError.message);
          } else {
            totalInserted += batch.length;
          }
        }
      }
    }

    return { success: true, inserted: totalInserted };
  } catch (err) {
    console.error('[Backfill] Unexpected error during backfill:', err);
    return { success: false, inserted: 0 };
  }
}

