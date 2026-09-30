import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylist, type Playlist, removeTrackFromPlaylist, apiFetch, sendRecommendationFeedback } from '../lib/api';

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
          sendRecommendationFeedback(idStr, 'liked');
        } catch (err: any) {
          if (err?.status !== 409 && !err?.message?.includes('409')) {
            throw err;
          }
        }
      }
    },
    // Optimistic update: the heart fills/empties instantly instead of waiting for the refetch
    onMutate: async (trackId) => {
      const key = ['playlist', 'liked-songs'];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Playlist>(key);
      if (previous) {
        const target = String(trackId).toLowerCase().trim();
        const has = previous.tracks.some((t) => String(t.trackId).toLowerCase().trim() === target);
        const tracks = has
          ? previous.tracks.filter((t) => String(t.trackId).toLowerCase().trim() !== target)
          : [...previous.tracks, { trackId: String(trackId), position: previous.tracks.length, addedAt: new Date().toISOString() }];
        queryClient.setQueryData<Playlist>(key, { ...previous, tracks });
      }
      return { previous };
    },
    onError: (_err, _trackId, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['playlist', 'liked-songs'], ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['playlist', 'liked-songs'] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const toggleLike = (trackId: string | number) => {
    toggleMutation.mutate(trackId);
  };

  return { isLiked, toggleLike };
}
