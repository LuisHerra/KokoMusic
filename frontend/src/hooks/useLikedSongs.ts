import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylist, removeTrackFromPlaylist, apiFetch } from '../lib/api';

export function useLikedSongs() {
  const queryClient = useQueryClient();

  const { data: likedPlaylist } = useQuery({
    queryKey: ['playlist', 'liked-songs'],
    queryFn: () => getPlaylist('liked-songs'),
    staleTime: 1000 * 60 * 5,
  });

  const isLiked = (trackId: string | number) => {
    if (!trackId || !likedPlaylist?.tracks) return false;
    const targetId = String(trackId).toLowerCase().trim();
    return likedPlaylist.tracks.some((t) => String(t.trackId).toLowerCase().trim() === targetId);
  };

  const toggleMutation = useMutation({
    mutationFn: async (trackId: string | number) => {
      const idStr = String(trackId);
      const currentlyLiked = isLiked(idStr);
      if (currentlyLiked) {
        await removeTrackFromPlaylist('liked-songs', idStr);
      } else {
        try {
          await apiFetch(`/playlists/liked-songs/tracks`, {
            method: 'POST',
            body: JSON.stringify({ trackId: idStr }),
          });
        } catch (err: any) {
          if (err?.status !== 409 && !err?.message?.includes('409')) {
            throw err;
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', 'liked-songs'] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const toggleLike = (trackId: string | number) => {
    toggleMutation.mutate(trackId);
  };

  return { isLiked, toggleLike };
}
