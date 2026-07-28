/**
 * usePrefetchAudio — Predictive next-song prefetch hook
 *
 * Called from useAudioPlayer when a track starts playing.
 * Reads the next 2 tracks from the player queue and fires a background
 * prefetch request so they are locally cached before they start playing.
 *
 * This eliminates the yt-dlp cold start (1-3s delay) for queued songs.
 */

import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { prefetchAudio } from '../lib/api';

export function usePrefetchAudio() {
  const { currentTrack, queue } = usePlayerStore();

  useEffect(() => {
    if (!currentTrack) return;

    // Find where we are in the queue
    const currentIndex = queue.findIndex(t => t.id === currentTrack.id);
    if (currentIndex === -1) return;

    // Take the next 2 tracks
    const upcoming = queue.slice(currentIndex + 1, currentIndex + 3);
    if (upcoming.length === 0) return;

    const ids = upcoming
      .map(t => t.id)
      .filter(Boolean) as string[];

    if (ids.length === 0) return;

    // Fire-and-forget — backend schedules background download if not already cached
    prefetchAudio(ids).catch(() => {});
  }, [currentTrack?.id]); // Only re-run when the current track changes
}
