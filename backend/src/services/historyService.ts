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
import { TrackMetadata } from './metadataService';
import { supabase } from './supabaseService';
import { hashStringToInteger } from './artistService';

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
  genre?: string;
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

// ── Supabase user_history sync ───────────────────────────────────────────────

/**
 * Upsert an aggregated history row into kokomusic.user_history.
 * Called non-blocking (fire-and-forget) after every play / session save.
 * This table is the durable mirror of user_history.json so data survives
 * git commits and server restarts.
 */
async function upsertCloudHistory(
  userId: string,
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string },
  playedAt: string,
  sessionSeconds?: number
): Promise<void> {
  if (!supabase || !userId) return;
  try {
    // Read current row (if any) to merge plays array
    const { data: existing } = await supabase
      .schema('kokomusic')
      .from('user_history')
      .select('play_count, plays, session_data, last_played')
      .eq('user_id', userId)
      .eq('track_id', trackId)
      .maybeSingle();

    const currentPlays: string[] = (existing as any)?.plays ?? [];
    const currentSessions: { date: string; seconds: number }[] = (existing as any)?.session_data ?? [];
    const currentCount: number = (existing as any)?.play_count ?? 0;
    const currentLast: string = (existing as any)?.last_played ?? playedAt;

    const newPlays = sessionSeconds === undefined
      ? [...currentPlays, playedAt]   // new play event
      : currentPlays;                  // session update only

    const newSessions =
      sessionSeconds !== undefined && sessionSeconds >= 5
        ? [...currentSessions, { date: playedAt, seconds: Math.round(sessionSeconds) }]
        : currentSessions;

    const newCount = sessionSeconds === undefined ? currentCount + 1 : currentCount;
    const newLast =
      new Date(playedAt) > new Date(currentLast) ? playedAt : currentLast;

    await supabase
      .schema('kokomusic')
      .from('user_history')
      .upsert(
        {
          user_id:      userId,
          track_id:     trackId,
          title:        trackInfo.title,
          artist:       trackInfo.artist,
          cover:        trackInfo.cover || '',
          play_count:   newCount,
          last_played:  newLast,
          plays:        newPlays,
          session_data: newSessions,
        },
        { onConflict: 'user_id,track_id' }
      );
  } catch (err) {
    console.error('[History] upsertCloudHistory error:', err);
  }
}

/**
 * Loads the aggregated user_history from Supabase and writes it to the
 * local JSON cache. Called once at server startup so the local file
 * is always up-to-date even after a fresh git checkout.
 */
export async function hydrateLocalHistoryFromCloud(): Promise<void> {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('user_history')
      .select('user_id, track_id, title, artist, cover, play_count, last_played, plays, session_data')
      .order('last_played', { ascending: false })
      .limit(5000);

    if (error || !data || data.length === 0) return;

    const hydrated: HistoryEntry[] = (data as any[]).map((row) => ({
      trackId:         row.track_id  as string,
      title:           row.title     as string,
      artist:          row.artist    as string,
      cover:           (row.cover    as string) || '',
      playCount:       (row.play_count as number) || 1,
      lastPlayed:      row.last_played as string,
      plays:           (row.plays    as string[]) || [],
      minutesBySession: (row.session_data as { date: string; seconds: number }[]) || [],
      userId:          row.user_id   as string,
    }));

    writeHistory(hydrated);
    console.log(`[History] Hydrated ${hydrated.length} entries from cloud user_history`);
  } catch (err) {
    console.error('[History] hydrateLocalHistoryFromCloud error:', err);
  }
}

/**
 * Resolves the aggregated history for a user.
 * Priority: kokomusic.user_history (fast, aggregated) → play_events (detail) → local JSON.
 * Date filtering is supported via play_events when startDate/endDate are provided.
 */
export async function getHistoryForUser(
  userId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<HistoryEntry[]> {
  if (!userId) {
    return readHistory();
  }

  if (supabase) {
    // Fast path: use user_history (aggregated) when no date range is needed
    if (!startDate && !endDate) {
      try {
        const { data, error } = await supabase
          .schema('kokomusic')
          .from('user_history')
          .select('track_id, title, artist, cover, play_count, last_played, plays, session_data')
          .eq('user_id', userId)
          .order('last_played', { ascending: false })
          .limit(2000);

        if (!error && data && data.length > 0) {
          return (data as any[]).map((row) => ({
            trackId:          row.track_id as string,
            title:            row.title    as string,
            artist:           row.artist   as string,
            cover:            (row.cover   as string) || '',
            playCount:        (row.play_count as number) || 1,
            lastPlayed:       row.last_played as string,
            plays:            (row.plays    as string[]) || [],
            minutesBySession: (row.session_data as { date: string; seconds: number }[]) || [],
            userId,
          }));
        }
      } catch (err) {
        console.error('[History] user_history cloud read failed, falling back to play_events:', err);
      }
    }

    // Detailed path: use play_events when date range is requested
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
              userId,
            };
          }
          historyMap[tid].playCount++;
          (historyMap[tid].plays ??= []).push(playedAt);
          if (seconds > 0) {
            (historyMap[tid].minutesBySession ??= []).push({ date: playedAt, seconds });
          }
          if (new Date(playedAt) > new Date(historyMap[tid].lastPlayed)) {
            historyMap[tid].lastPlayed = playedAt;
          }
        }
        return Object.values(historyMap);
      }
    } catch (err) {
      console.error('[History] play_events read failed, falling back to local JSON:', err);
    }
  }

  // Final fallback: local JSON
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
 * Writes to Supabase play_events (event log) + user_history (aggregated),
 * then updates local JSON cache.
 */
export function logTrackPlay(
  trackId: string,
  trackInfo: { title: string; artist: string; cover: string; genre?: string },
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
      ...(trackInfo.genre ? { genre: trackInfo.genre } : {}),
      playCount: 1,
      lastPlayed: now,
      plays: [now],
      userId,
    };
    history.push(entry);
  }
  writeHistory(history);

  // Supabase writes (non-blocking — fire and forget)
  if (userId) {
    // 1. Append detailed event to play_events (source of truth for stats)
    insertPlayEvent(userId, deviceId || 'unknown', trackId, trackInfo, now).catch(() => {});
    // 2. Upsert aggregated row in user_history (survives git commits)
    upsertCloudHistory(userId, trackId, trackInfo, now).catch(() => {});
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

    if (userId) {
      // 2. Update play_events with real seconds_listened
      await updateEventSeconds(
        userId,
        deviceId || 'unknown',
        session.trackId,
        playedAt,
        roundedSecs
      );
      // 3. Append session seconds to user_history (aggregated, durable)
      upsertCloudHistory(
        userId,
        session.trackId,
        { title: session.title, artist: session.artist, cover: session.cover },
        playedAt,
        roundedSecs
      ).catch(() => {});
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

