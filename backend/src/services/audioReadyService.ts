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
 * Mark a YouTube track as locally cached.
 * Writes to both L1 (memory) and L2 (Supabase tracks_meta).
 */
export async function markTrackAudioReady(youtubeId: string): Promise<void> {
  // L1: immediate in-memory flag
  cache.setex(`${AUDIO_READY_CACHE_PREFIX}${youtubeId}`, AUDIO_READY_CACHE_TTL, '1');

  // L2: persist to Supabase so it survives restarts
  if (!supabase) return;
  try {
    const { error } = await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .update({
        audio_ready: true,
        youtube_id: youtubeId,
        audio_cached_at: new Date().toISOString(),
      })
      .eq('youtube_id', youtubeId);

    if (error) {
      // youtube_id column may not be set yet — try upsert by matching existing youtube_id
      // This is a best-effort operation; local fs check is the source of truth
      console.warn(`[AudioReady] Could not update tracks_meta for ${youtubeId}:`, error.message);
    }
  } catch (err) {
    console.warn('[AudioReady] Supabase write failed (non-critical):', err);
  }
}

/**
 * Mark a youtube_id on a track record that we know its itunes_id for.
 * Called when we resolve an iTunes track to a YouTube video.
 */
export async function linkYouTubeIdToTrack(itunesId: number, youtubeId: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .update({ youtube_id: youtubeId })
      .eq('itunes_id', itunesId);
  } catch {
    // Non-critical
  }
}

/**
 * Check if a track is locally cached.
 * Order: L1 memory → filesystem check (authoritative).
 * Does NOT query Supabase (too slow for hot path).
 */
export function isTrackAudioReady(youtubeId: string): boolean {
  // L1 cache hit
  if (cache.get(`${AUDIO_READY_CACHE_PREFIX}${youtubeId}`)) return true;

  // Filesystem check — most reliable source of truth
  try {
    const localPath = getAudioPath(youtubeId);
    const exists = fs.existsSync(localPath) && fs.statSync(localPath).size > 1024;
    if (exists) {
      // Warm the cache for next call
      cache.setex(`${AUDIO_READY_CACHE_PREFIX}${youtubeId}`, AUDIO_READY_CACHE_TTL, '1');
    }
    return exists;
  } catch {
    return false;
  }
}

/**
 * Batch check — returns a map of youtubeId → ready status.
 * Used by GET /api/stream/status endpoint.
 */
export function batchCheckAudioReady(youtubeIds: string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const id of youtubeIds) {
    result[id] = isTrackAudioReady(id);
  }
  return result;
}
