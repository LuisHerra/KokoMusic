/**
 * recommendationCache.ts — KokoMusic Online Recommendation Layer
 *
 * In-memory (+ optional Supabase-backed) cache for pre-computed recommendation
 * playlists. Implements:
 *   - TTL-based expiry (6h default)
 *   - Stale-while-revalidate: serve stale immediately, refresh in background
 *   - Selective invalidation:
 *       • 3 consecutive skips → immediate recompute
 *       • like / add-to-playlist → mark stale (recomputes on next cycle)
 *   - Feedback signal integration (skip, complete, like, add)
 *
 * DESIGN CONSTRAINTS:
 *   • The online path NEVER waits for recompute — always serve from cache.
 *   • Recompute always runs in background (setImmediate / fire-and-forget).
 */

import type { EnrichedCandidate } from './candidateGenerator';

// ── Config ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = Number(process.env.REC_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000); // 6h
const SKIP_THRESHOLD = 3;       // consecutive skips → immediate invalidation
const MIN_HISTORY_PLAYS = 10;   // below this: cold-start path

// ── Feedback weights ──────────────────────────────────────────────────────────
export const FEEDBACK_WEIGHTS = {
  skip: -0.3,
  track_completed: +0.5,
  liked: +1.0,
  added_to_playlist: +0.8,
} as const;

export type FeedbackEvent = keyof typeof FEEDBACK_WEIGHTS;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedPlaylist {
  userId: string;
  candidates: EnrichedCandidate[];
  computedAt: number;      // Date.now() when computed
  stale: boolean;          // true = serve but recompute on next cycle
  invalidatedAt?: number;  // when it was invalidated (for logging)
}

export interface FeedbackAccumulator {
  consecutiveSkips: number;
  pendingSignals: { trackId: string; event: FeedbackEvent; ts: number }[];
}

// ── In-process store ──────────────────────────────────────────────────────────
// Key: userId → CachedPlaylist
const playlistCache = new Map<string, CachedPlaylist>();
// Key: userId → FeedbackAccumulator
const feedbackStore = new Map<string, FeedbackAccumulator>();
// Tracks which users have a background recompute in-flight (prevents duplicate jobs)
const recomputeInFlight = new Set<string>();

// ── Cache operations ──────────────────────────────────────────────────────────

/** Returns cached playlist for userId (may be stale). null if nothing cached. */
export function getCachedPlaylist(userId: string): CachedPlaylist | null {
  return playlistCache.get(userId) ?? null;
}

/** Writes a new (or refreshed) playlist to cache. */
export function setCachedPlaylist(userId: string, candidates: EnrichedCandidate[]): void {
  playlistCache.set(userId, {
    userId,
    candidates,
    computedAt: Date.now(),
    stale: false,
  });
}

/** Returns true if the cache entry is fresh (within TTL) and not stale. */
export function isCacheFresh(entry: CachedPlaylist): boolean {
  return !entry.stale && Date.now() - entry.computedAt < CACHE_TTL_MS;
}

/** Marks a user's cache as stale (deferred invalidation — does NOT recompute). */
export function markCacheStale(userId: string): void {
  const entry = playlistCache.get(userId);
  if (entry) {
    entry.stale = true;
    entry.invalidatedAt = Date.now();
    console.log(`[RecCache] Cache marked stale for ${userId} (deferred recompute)`);
  }
}

/** Clears (deletes) a user's cache entry — forces cold miss on next request. */
export function clearCache(userId: string): void {
  playlistCache.delete(userId);
  feedbackStore.delete(userId);
  recomputeInFlight.delete(userId);
}

// ── Feedback signal processing ─────────────────────────────────────────────────

function getOrCreateFeedback(userId: string): FeedbackAccumulator {
  if (!feedbackStore.has(userId)) {
    feedbackStore.set(userId, { consecutiveSkips: 0, pendingSignals: [] });
  }
  return feedbackStore.get(userId)!;
}

/**
 * Records a feedback event. Returns the action taken:
 *   'immediate_recompute' — 3 consecutive skips triggered
 *   'marked_stale'        — like/add-to-playlist deferred invalidation
 *   'logged'              — signal recorded, no cache change
 */
export function recordFeedback(
  userId: string,
  trackId: string,
  event: FeedbackEvent,
  triggerRecompute: (userId: string) => void
): 'immediate_recompute' | 'marked_stale' | 'logged' {
  const fb = getOrCreateFeedback(userId);

  fb.pendingSignals.push({ trackId, event, ts: Date.now() });

  // Track consecutive skips
  if (event === 'skip') {
    fb.consecutiveSkips++;
    if (fb.consecutiveSkips >= SKIP_THRESHOLD) {
      fb.consecutiveSkips = 0;
      console.log(`[RecCache] 3 consecutive skips for ${userId} — immediate recompute`);
      clearCache(userId);
      triggerRecompute(userId);
      return 'immediate_recompute';
    }
  } else {
    // Any non-skip event resets the streak
    fb.consecutiveSkips = 0;
  }

  // Like or add-to-playlist → deferred stale
  if (event === 'liked' || event === 'added_to_playlist') {
    markCacheStale(userId);
    return 'marked_stale';
  }

  return 'logged';
}

// ── Background recompute orchestration ────────────────────────────────────────

/**
 * Schedules a background recompute for a user.
 * Prevents duplicate concurrent jobs via recomputeInFlight set.
 *
 * @param userId
 * @param recomputeFn — async function that generates new candidates and updates cache
 */
export function scheduleBackgroundRecompute(
  userId: string,
  recomputeFn: () => Promise<void>
): void {
  if (recomputeInFlight.has(userId)) {
    console.log(`[RecCache] Recompute already in-flight for ${userId}, skipping`);
    return;
  }

  recomputeInFlight.add(userId);

  setImmediate(async () => {
    try {
      console.log(`[RecCache] Background recompute started for ${userId}`);
      await recomputeFn();
      console.log(`[RecCache] Background recompute completed for ${userId}`);
    } catch (err) {
      console.error(`[RecCache] Background recompute error for ${userId}:`, err);
    } finally {
      recomputeInFlight.delete(userId);
    }
  });
}

// ── Cold-start detection ───────────────────────────────────────────────────────

/**
 * Returns true if the user has insufficient history for taste-profile-based recs.
 * Reads from local JSON cache (fast, no DB call).
 */
export function isColdStart(userId: string): boolean {
  if (getCachedPlaylist(userId)) return false; // If we have cached recs (e.g. from seeded onboarding), not a cold start

  // Bypass cold start for Koko profiles (pre-seeded taste)
  const KOKO_IDS = ['9847b87c-04e7-4595-af2f-3c02448ebf67', '773d55a4-0cd3-4504-a4e4-04c2b0b80052', '2cd6438b-2ce9-4f5f-8b82-c41896009981'];
  if (KOKO_IDS.includes(userId) || userId.toLowerCase().includes('koko')) {
    return false;
  }

  try {
    const { readHistory } = require('./historyService');
    const history = (readHistory() as any[]).filter((h: any) => h.userId === userId);
    const totalPlays = history.reduce((s: number, h: any) => s + (h.playCount || 0), 0);
    return totalPlays < MIN_HISTORY_PLAYS;
  } catch {
    return true;
  }
}

// ── Cache stats (for health/debug endpoint) ────────────────────────────────────

export function getCacheStats() {
  const entries = [...playlistCache.values()];
  return {
    totalUsers: entries.length,
    freshEntries: entries.filter(isCacheFresh).length,
    staleEntries: entries.filter((e) => e.stale).length,
    inFlightRecomputes: recomputeInFlight.size,
  };
}
