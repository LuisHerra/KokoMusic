/**
 * useJamSession — Supabase Realtime listener for Jam playback sync.
 * Listeners subscribe to DB changes on the `jams` table for their jam_code.
 * The host broadcasts state changes; members react to them.
 */
import { useEffect, useRef, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { updateJamState, endJam } from '../lib/api';
import type { JamMember } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Lazy supabase client for realtime (anon key — read only)
let _rtClient: ReturnType<typeof createClient> | null = null;
function getRtClient() {
  if (!_rtClient && SUPABASE_URL && SUPABASE_ANON_KEY) {
    _rtClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return _rtClient;
}

export interface UseJamSessionOptions {
  jamCode: string | null;
  jamId: string | null;
  userId: string;
  isHost: boolean;
  onStateChange?: (state: {
    track_id: string | null;
    track_title: string | null;
    track_artist: string | null;
    track_cover: string | null;
    position_s: number;
    is_playing: boolean;
  }) => void;
  onMemberJoined?: (member: JamMember) => void;
}

export function useJamSession({
  jamCode,
  jamId,
  userId,
  isHost,
  onStateChange,
  onMemberJoined,
}: UseJamSessionOptions) {
  const channelRef = useRef<ReturnType<typeof createClient>['channel'] extends (...args: any[]) => infer R ? R : never | null>(null);
  const syncIntervalRef = useRef<number | null>(null);
  const { currentTrack, isPlaying, progress } = usePlayerStore();

  // ── Host: broadcast state every 5 s ──────────────────────────────────────
  const syncHostState = useCallback(() => {
    if (!isHost || !jamCode || !userId || !currentTrack) return;
    updateJamState(jamCode, userId, {
      track_id: currentTrack.id,
      track_title: currentTrack.title,
      track_artist: currentTrack.artist,
      track_cover: currentTrack.cover,
      position_s: progress,
      is_playing: isPlaying,
    }).catch(() => {/* silent */});
  }, [isHost, jamCode, userId, currentTrack, progress, isPlaying]);

  // ── Subscribe to Realtime changes ─────────────────────────────────────────
  useEffect(() => {
    if (!jamId || !jamCode) return;
    const client = getRtClient();
    if (!client) return;

    const channel = client
      .channel(`jam-${jamId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'kokomusic', table: 'jams', filter: `id=eq.${jamId}` },
        (payload: any) => {
          const syncEnabled = usePlayerStore.getState().isSinfoniaSyncEnabled;
          if (!isHost && syncEnabled) onStateChange?.(payload.new);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'kokomusic', table: 'jam_members', filter: `jam_id=eq.${jamId}` },
        (payload: any) => {
          onMemberJoined?.(payload.new);
        }
      )
      .subscribe();

    channelRef.current = channel as any;

    // Host syncs every 5 s
    if (isHost) {
      syncHostState();
      syncIntervalRef.current = window.setInterval(syncHostState, 5000);
    }

    return () => {
      client.removeChannel(channel);
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [jamId, jamCode, isHost]);

  // Re-sync host immediately on track/play state change
  useEffect(() => {
    if (isHost) syncHostState();
  }, [currentTrack?.id, isPlaying, syncHostState]);

  const leaveJam = useCallback(() => {
    const client = getRtClient();
    if (channelRef.current && client) client.removeChannel(channelRef.current as any);
    if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    if (isHost && jamCode) endJam(jamCode, userId).catch(() => {});
  }, [isHost, jamCode, userId]);

  return { leaveJam };
}
