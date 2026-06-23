/**
 * useFollowArtist — KokoMusic 4b
 * Hook that manages follow/unfollow for a specific artist.
 * Optimistic UI: state updates immediately, request fires in background.
 */

import { useState, useEffect } from 'react';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

interface UseFollowArtistResult {
  isFollowing: boolean;
  isLoading: boolean;
  toggleFollow: () => Promise<void>;
}

export function useFollowArtist(
  artistId: number | null | undefined,
  artistName?: string,
  artistImage?: string
): UseFollowArtistResult {
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch initial follow status
  useEffect(() => {
    if (!artistId) return;

    let cancelled = false;
    const userId = localStorage.getItem('koko_device_id') || '';
    fetch(`${BASE}/artist/${artistId}/follow-status`, {
      headers: {
        'Content-Type': 'application/json',
        ...(userId ? { 'x-user-id': userId } : {})
      }
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setIsFollowing(data.following ?? false);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [artistId]);

  const toggleFollow = async () => {
    if (!artistId || !artistName || isLoading) return;

    // Optimistic update
    const prev = isFollowing;
    setIsFollowing(!prev);
    setIsLoading(true);

    try {
      const userId = localStorage.getItem('koko_device_id') || '';
      const res = await fetch(`${BASE}/artist/${artistId}/follow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {})
        },
        body: JSON.stringify({
          artistName,
          artistImage,
          action: prev ? 'unfollow' : 'follow',
        }),
      });
      const data = await res.json();
      // Sync with server response
      setIsFollowing(data.following ?? !prev);
    } catch (err) {
      // Revert on error
      console.error('[useFollowArtist] Error toggling follow:', err);
      setIsFollowing(prev);
    } finally {
      setIsLoading(false);
    }
  };

  return { isFollowing, isLoading, toggleFollow };
}
