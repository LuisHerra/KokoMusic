/**
 * Audio Ready Service
 *
 * Tracks which YouTube tracks are locally cached as opus files.
 * Persists the audio_ready flag to Supabase (tracks_meta) so the state
 * survives server restarts and can be queried by the frontend before
 * triggering a yt-dlp cold start.
 */

import { supabase } from './supabaseService';
import { cache } from './cacheService';
import { getAudioPath } from './ytdlpService';
import fs from 'fs';

const AUDIO_READY_CACHE_PREFIX = 'audio-ready:';
const AUDIO_READY_CACHE_TTL = 60 * 60; // 1 hour in-memory TTL

/**
 * Mark a track (by iTunes ID or YouTube ID) as locally/CDN cached.
 * Writes to both L1 (memory) and L2 (Supabase tracks_meta).
 */
export async function markTrackAudioReady(trackId: string, mappedId?: string): Promise<void> {
  // L1: immediate in-memory flags
  cache.setex(`${AUDIO_READY_CACHE_PREFIX}${trackId}`, AUDIO_READY_CACHE_TTL, '1');
  if (mappedId) {
    cache.setex(`${AUDIO_READY_CACHE_PREFIX}${mappedId}`, AUDIO_READY_CACHE_TTL, '1');
    cache.setex(`yt-res:${trackId}`, 86400 * 30, mappedId);
    cache.setex(`yt-res:${mappedId}`, 86400 * 30, trackId);
  }

  // L2: persist to Supabase so it survives restarts
  if (!supabase) return;
  try {
    const updatePayload: any = {
      audio_ready: true,
      audio_cached_at: new Date().toISOString(),
    };
    if (mappedId) updatePayload.youtube_id = mappedId;

    await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .update(updatePayload)
      .or(`id.eq.${trackId},youtube_id.eq.${trackId}${mappedId ? `,youtube_id.eq.${mappedId}` : ''}`);
  } catch (err) {
    console.warn('[AudioReady] Supabase write failed (non-critical):', err);
  }
}

/**
 * Mark a youtube_id on a track record that we know its itunes_id for.
 * Called when we resolve an iTunes track to a YouTube video.
 */
export async function linkYouTubeIdToTrack(itunesId: number, youtubeId: string): Promise<void> {
  cache.setex(`yt-res:${itunesId}`, 86400 * 30, youtubeId);
  if (!supabase) return;
  try {
    await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .update({ youtube_id: youtubeId })
      .eq('id', String(itunesId));
  } catch {
    // Non-critical
  }
}

/**
 * Check if a track (by iTunes ID or YouTube ID) is locally cached or in CDN.
 * Order: L1 memory → CDN cache → mapped YouTube ID → filesystem check.
 */
export function isTrackAudioReady(trackId: string): boolean {
  if (!trackId) return false;

  // 1. L1 cache hit for trackId
  if (cache.get(`${AUDIO_READY_CACHE_PREFIX}${trackId}`)) return true;

  // 2. CDN cache hit for trackId
  if (cache.get(`cdn-url:${trackId}`)) return true;

  // 3. Mapped YouTube ID check
  const mappedYtId = cache.get(`yt-res:${trackId}`) as string | undefined;
  if (mappedYtId) {
    if (cache.get(`${AUDIO_READY_CACHE_PREFIX}${mappedYtId}`)) return true;
    if (cache.get(`cdn-url:${mappedYtId}`)) return true;
  }

  // 4. Filesystem check for direct trackId
  try {
    const localPath = getAudioPath(trackId);
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 1024) {
      cache.setex(`${AUDIO_READY_CACHE_PREFIX}${trackId}`, AUDIO_READY_CACHE_TTL, '1');
      if (mappedYtId) cache.setex(`${AUDIO_READY_CACHE_PREFIX}${mappedYtId}`, AUDIO_READY_CACHE_TTL, '1');
      return true;
    }
  } catch {}

  // 5. Filesystem check for mappedYtId
  if (mappedYtId) {
    try {
      const mappedPath = getAudioPath(mappedYtId);
      if (fs.existsSync(mappedPath) && fs.statSync(mappedPath).size > 1024) {
        cache.setex(`${AUDIO_READY_CACHE_PREFIX}${trackId}`, AUDIO_READY_CACHE_TTL, '1');
        cache.setex(`${AUDIO_READY_CACHE_PREFIX}${mappedYtId}`, AUDIO_READY_CACHE_TTL, '1');
        return true;
      }
    } catch {}
  }

  return false;
}

/**
 * Batch check — returns a map of trackId → ready status.
 * Used by GET /api/stream/status endpoint. Bulk-checks Supabase for cold tracks.
 */
export async function batchCheckAudioReady(trackIds: string[]): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  const missing: string[] = [];

  for (const id of trackIds) {
    const ready = isTrackAudioReady(id);
    result[id] = ready;
    if (!ready) missing.push(id);
  }

  // Bulk check Supabase tracks_meta for missing IDs
  if (missing.length > 0 && supabase) {
    try {
      const { data } = await supabase
        .schema('kokomusic')
        .from('tracks_meta')
        .select('id, youtube_id, audio_ready')
        .or(missing.map(id => `id.eq.${id},youtube_id.eq.${id}`).join(','));

      if (data) {
        data.forEach(row => {
          if (row.audio_ready) {
            if (row.id) {
              result[row.id] = true;
              cache.setex(`${AUDIO_READY_CACHE_PREFIX}${row.id}`, AUDIO_READY_CACHE_TTL, '1');
            }
            if (row.youtube_id) {
              result[row.youtube_id] = true;
              cache.setex(`${AUDIO_READY_CACHE_PREFIX}${row.youtube_id}`, AUDIO_READY_CACHE_TTL, '1');
            }
          }
        });
      }
    } catch {
      // Non-critical
    }
  }

  return result;
}
