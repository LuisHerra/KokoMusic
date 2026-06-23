import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylist, removeTrackFromPlaylist } from '../lib/api';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';

/** Adds a track to a playlist, silently ignoring 409 (already exists). */
async function addTrackSafe(playlistId: string, trackId: string): Promise<void> {
  const res = await fetch(`${BASE}/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackId }),
  });
  // 409 = track already in playlist → treat as success
  if (!res.ok && res.status !== 409) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Error al añadir canción');
  }
}

export function useLikedSongs() {
  const queryClient = useQueryClient();

  const { data: likedPlaylist } = useQuery({
    queryKey: ['playlist', 'liked-songs'],
    queryFn: () => getPlaylist('liked-songs'),
  });

  const isLiked = (trackId: string) => {
    return likedPlaylist?.tracks.some((t) => t.trackId === trackId) ?? false;
  };

  const toggleMutation = useMutation({
    mutationFn: async (trackId: string) => {
      const currentlyLiked = isLiked(trackId);
      if (currentlyLiked) {
        await removeTrackFromPlaylist('liked-songs', trackId);
      } else {
        await addTrackSafe('liked-songs', trackId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', 'liked-songs'] });
    },
  });

  const toggleLike = (trackId: string) => {
    toggleMutation.mutate(trackId);
  };

  return { isLiked, toggleLike };
}
