/**
 * useListeningSession
 * Accumulates listening time in-memory during a session.
 * Sends ONE request to the backend only when the user exits the app
 * (beforeunload / pagehide / visibilitychange=hidden) to avoid polling.
 *
 * Each session entry includes `playedAt` (when the play was first logged)
 * so the backend can find the matching play_event and update seconds_listened.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '../store/playerStore';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

interface SessionEntry {
  trackId: string;
  seconds: number;
  title: string;
  artist: string;
  cover: string;
  /** ISO timestamp of when this track was first played (for accurate event window matching) */
  playedAt: string;
}

export function useListeningSession() {
  /** Accumulator: { [trackId]: SessionEntry } — lives entirely in a ref, no renders */
  const sessionData = useRef<Record<string, SessionEntry>>({});

  useEffect(() => {
    let lastProgress = -1;
    let lastTrackId: string | null = null;
    let trackStartTime: string | null = null; // ISO timestamp when current track started

    const unsubscribe = usePlayerStore.subscribe((state) => {
      const { currentTrack, isPlaying, progress } = state;

      if (!currentTrack || !isPlaying) {
        lastProgress = progress;
        return;
      }

      const trackId = currentTrack.id;

      // Track changed → record start time and reset reference point
      if (lastTrackId !== trackId) {
        lastProgress = progress;
        lastTrackId = trackId;
        trackStartTime = new Date().toISOString();

        // Initialize session entry for this track if not already present
        if (!sessionData.current[trackId]) {
          sessionData.current[trackId] = {
            trackId,
            seconds: 0,
            title: currentTrack.title,
            artist: currentTrack.artist,
            cover: currentTrack.cover,
            playedAt: trackStartTime,
          };
        }
        return;
      }

      const delta = progress - lastProgress;

      // Only count forward increments smaller than 5s (ignores seeks/jumps)
      if (delta > 0 && delta < 5) {
        if (!sessionData.current[trackId]) {
          sessionData.current[trackId] = {
            trackId,
            seconds: 0,
            title: currentTrack.title,
            artist: currentTrack.artist,
            cover: currentTrack.cover,
            playedAt: trackStartTime ?? new Date().toISOString(),
          };
        }
        sessionData.current[trackId].seconds += delta;
      }

      lastProgress = progress;
    });

    return unsubscribe;
  }, []);

  const flushSession = useCallback(() => {
    const entries = Object.values(sessionData.current).filter((e) => e.seconds >= 5);
    if (entries.length === 0) return;

    const myId = localStorage.getItem('koko_device_id') ?? '';
    const payload = JSON.stringify({ sessions: entries });
    const params = new URLSearchParams();
    if (myId) {
      params.set('userId', myId);
      params.set('deviceId', myId); // device_id = koko_device_id for this installation
    }
    const url = `${BASE}/tracks/history/session?${params.toString()}`;

    // sendBeacon works even when the page is unloading
    if (typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
    } else {
      // Fallback: keepalive fetch
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }

    // Clear so we don't double-send
    sessionData.current = {};
  }, []);

  useEffect(() => {
    const onExit = () => flushSession();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSession();
    };

    window.addEventListener('beforeunload', onExit);
    window.addEventListener('pagehide', onExit);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('beforeunload', onExit);
      window.removeEventListener('pagehide', onExit);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushSession]);
}
