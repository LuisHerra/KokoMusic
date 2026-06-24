/**
 * API client centralizado con React Query.
 * Base URL desde variable de entorno VITE_API_URL.
 */

if (typeof window !== 'undefined' && !localStorage.getItem('koko_device_id')) {
  localStorage.setItem('koko_device_id', crypto.randomUUID());
}

export const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';


async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const userId = localStorage.getItem('koko_device_id') || '';
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(userId ? { 'x-user-id': userId } : {}),
    ...(options?.headers || {}),
  };
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? 'Error desconocido');
  }
  return res.json() as Promise<T>;
}

export interface Track {
  id: string;           // iTunesTrackId (string)
  itunesId?: number;    // iTunesTrackId (number)
  artistId?: number;    // iTunesArtistId — para navegar a /artist/:id
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  genre?: string;
  popularity: number;
  preview_url: string | null;
  audioReady?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  cover?: string;
  tracks: { trackId: string; position: number; addedAt: string }[];
  createdAt: string;
  updatedAt: string;
}

// ── Search ────────────────────────────────────────────────────────────────────
export const searchTracks = (q: string, limit = 20, source: 'itunes' | 'youtube' | 'lyrics' = 'itunes') =>
  apiFetch<{ tracks: Track[]; source: string }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}&source=${source}`);

// ── Tracks ────────────────────────────────────────────────────────────────────
export const getTrack = (id: string) => apiFetch<Track & { audioReady: boolean }>(`/tracks/${id}`);

export const getStreamUrl = (trackId: string) => `${BASE}/stream/${trackId}`;

export interface Lyrics {
  id: number;
  name: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export const getLyrics = (trackId: string) => apiFetch<Lyrics>(`/tracks/${trackId}/lyrics`);

export interface VideoData {
  youtubeId: string | null;
  relatedVideos: {
    id: string;
    title: string;
    artist: string;
    thumbnail: string;
    views: number;
    duration: string;
  }[];
}

export const getTrackVideo = (trackId: string) => apiFetch<VideoData>(`/tracks/${trackId}/video`);

export const logTrackPlay = (
  trackId: string,
  track: { title: string; artist: string; cover: string },
  userId?: string,
  deviceId?: string
) =>
  apiFetch<{ success: boolean }>(
    `/tracks/${trackId}/play?${new URLSearchParams({
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
    }).toString()}`,
    { method: 'POST', body: JSON.stringify(track) }
  );

export const getRecommendations = (limit = 10, mood?: string, seedTrackId?: string) => {
  const params = new URLSearchParams({ limit: String(limit) });
  if (mood) params.append('mood', mood);
  if (seedTrackId) params.append('seedTrackId', seedTrackId);
  return apiFetch<Track[]>(`/tracks/recommendations?${params.toString()}`);
};

export const getStreamStatus = (trackId: string) =>
  apiFetch<{ cached: boolean; downloading: boolean; status: string }>(`/stream/${trackId}/status`);

export const getAlbum = (id: string) => apiFetch<any>(`/album/${id}`);

export interface StatsData {
  totalPlays: number;
  totalMinutes: number;
  trendPercentage: number;
  uniqueArtists: number;
  newArtistsCount: number;
  artistAvatars: string[];
  artistAvatarsExtra: number;
  topGenre: string;
  topGenrePercentage: number;
  topGenreCover: string;
  revelationArtistImage: string;
  mostPlayedTrackCover: string;
  genreDistribution: { name: string; count: number; percentage: number }[];
  listeningEvolution: { date: string; count: number }[];
  moods: { name: string; percentage: number; color: string }[];
  topTracks: any[];
  topArtists: { name: string; image: string; count: number }[];
  highlights: {
    favoriteDay: string;
    favoriteDayPercentage: number;
    favoriteHour: string;
    longestStreak: number;
  };
  recentActivity: {
    type: string;
    text: string;
    time: string;
    image: string;
  }[];
}

export const getStats = (start?: string, end?: string, userId?: string) => {
  const params = new URLSearchParams();
  if (start) params.append('start', start);
  if (end) params.append('end', end);
  if (userId) params.append('userId', userId);
  const q = params.toString();
  return apiFetch<StatsData>(`/tracks/history/stats${q ? `?${q}` : ''}`);
};

export const getTasteProfile = () =>
  apiFetch<{
    genres: { name: string; count: number; percentage: number }[];
    topMoods: { name: string; count: number; percentage: number }[];
    totalTracks: number;
    resolvedTracks: number;
  }>('/tracks/taste-profile');

// Helper functions for client-side playlist track count serialization/caching
export function getPlaylistTrackCount(playlistId: string, tracks?: any[]): number {
  if (Array.isArray(tracks)) {
    const count = tracks.length;
    localStorage.setItem(`koko_count_${playlistId}`, String(count));
    return count;
  }
  const cached = localStorage.getItem(`koko_count_${playlistId}`);
  return cached ? parseInt(cached, 10) : 0;
}

export function incrementPlaylistTrackCount(playlistId: string): void {
  const cached = localStorage.getItem(`koko_count_${playlistId}`);
  const current = cached ? parseInt(cached, 10) : 0;
  localStorage.setItem(`koko_count_${playlistId}`, String(current + 1));
}

export function decrementPlaylistTrackCount(playlistId: string): void {
  const cached = localStorage.getItem(`koko_count_${playlistId}`);
  const current = cached ? parseInt(cached, 10) : 0;
  localStorage.setItem(`koko_count_${playlistId}`, String(Math.max(0, current - 1)));
}

// ── Playlists ─────────────────────────────────────────────────────────────────
export const getPlaylists = async () => {
  const playlists = await apiFetch<Playlist[]>('/playlists');
  playlists.forEach(p => getPlaylistTrackCount(p.id, p.tracks));
  return playlists;
};

export const getPlaylist = async (id: string) => {
  const playlist = await apiFetch<Playlist>(`/playlists/${id}`);
  getPlaylistTrackCount(playlist.id, playlist.tracks);
  return playlist;
};

export const createPlaylist = (data: { name: string; description?: string; cover?: string; tracks?: string[] }) =>
  apiFetch<Playlist>('/playlists', { method: 'POST', body: JSON.stringify(data) });

export const updatePlaylist = (id: string, data: { name?: string; description?: string; cover?: string }) =>
  apiFetch<Playlist>(`/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const deletePlaylist = (id: string) =>
  apiFetch<void>(`/playlists/${id}`, { method: 'DELETE' });

export const addTrackToPlaylist = async (playlistId: string, trackId: string) => {
  const res = await apiFetch<Playlist>(`/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ trackId }),
  });
  incrementPlaylistTrackCount(playlistId);
  return res;
};

export const removeTrackFromPlaylist = async (playlistId: string, trackId: string) => {
  const res = await apiFetch<Playlist>(`/playlists/${playlistId}/tracks/${trackId}`, { method: 'DELETE' });
  decrementPlaylistTrackCount(playlistId);
  return res;
};

export const reorderPlaylist = (playlistId: string, trackIds: string[]) =>
  apiFetch<Playlist>(`/playlists/${playlistId}/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ trackIds })
  });

export const smartReorderPlaylist = (playlistId: string) =>
  apiFetch<Playlist>(`/playlists/${playlistId}/smart-reorder`, {
    method: 'POST'
  });

// ── Collaborative Playlists ───────────────────────────────────────────────────

export interface CollabPlaylist {
  id: string;
  name: string;
  description: string;
  cover_url?: string;
  owner_id: string;
  share_code: string;
  created_at: string;
  updated_at: string;
  tracks?: CollabTrack[];
  collaborators?: CollabMember[];
}

export interface CollabTrack {
  playlist_id: string;
  track_id: string;
  position: number;
  added_by: string;
  added_at: string;
}

export interface CollabMember {
  user_id: string;
  display_name: string;
  role: 'owner' | 'editor' | 'viewer';
  joined_at: string;
}

export const getCollabPlaylists = async (userId: string) => {
  const playlists = await apiFetch<CollabPlaylist[]>(`/collab/playlists?userId=${encodeURIComponent(userId)}`);
  playlists.forEach(cp => getPlaylistTrackCount(cp.id || cp.share_code, cp.tracks));
  return playlists;
};

export const getCollabPlaylist = async (shareCode: string) => {
  const playlist = await apiFetch<CollabPlaylist>(`/collab/playlists/${shareCode}`);
  getPlaylistTrackCount(playlist.id || playlist.share_code, playlist.tracks);
  return playlist;
};

export const createCollabPlaylist = (data: {
  name: string; description?: string; cover_url?: string; owner_id: string; display_name?: string;
}) =>
  apiFetch<CollabPlaylist>('/collab/playlists', { method: 'POST', body: JSON.stringify(data) });

export const deleteCollabPlaylist = (id: string, userId: string) =>
  apiFetch<{ success: boolean; deleted?: boolean; left?: boolean }>(`/collab/playlists/${id}`, {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });

export const joinCollabPlaylist = (shareCode: string, userId: string, displayName?: string) =>
  apiFetch<{ playlistId: string }>(`/collab/playlists/${shareCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, display_name: displayName }),
  });

export const addTrackToCollabPlaylist = async (playlistId: string, trackId: string, addedBy: string) => {
  const res = await apiFetch<{ success: boolean; position: number }>(`/collab/playlists/${playlistId}/tracks`, {
    method: 'POST',
    body: JSON.stringify({ track_id: trackId, added_by: addedBy }),
  });
  incrementPlaylistTrackCount(playlistId);
  return res;
};

export const removeTrackFromCollabPlaylist = async (playlistId: string, trackId: string) => {
  const res = await apiFetch<{ success: boolean }>(`/collab/playlists/${playlistId}/tracks/${trackId}`, {
    method: 'DELETE',
  });
  decrementPlaylistTrackCount(playlistId);
  return res;
};

export const reorderCollabPlaylist = (playlistId: string, trackIds: string[]) =>
  apiFetch<{ success: boolean }>(`/collab/playlists/${playlistId}/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ trackIds }),
  });

export const smartReorderCollabPlaylist = (playlistId: string) =>
  apiFetch<{ success: boolean }>(`/collab/playlists/${playlistId}/smart-reorder`, {
    method: 'POST'
  });

// ── Jam Sessions ─────────────────────────────────────────────────────────────

export interface JamSession {
  id: string;
  host_id: string;
  host_name: string;
  jam_code: string;
  track_id: string | null;
  track_title: string | null;
  track_artist: string | null;
  track_cover: string | null;
  position_s: number;
  is_playing: boolean;
  created_at: string;
  expires_at: string;
  members?: JamMember[];
}

export interface JamMember {
  user_id: string;
  display_name: string;
  joined_at: string;
}

export const startJam = (hostId: string, hostName?: string) =>
  apiFetch<JamSession>('/collab/jam/start', {
    method: 'POST',
    body: JSON.stringify({ host_id: hostId, host_name: hostName }),
  });

export const getJam = (jamCode: string) =>
  apiFetch<JamSession>(`/collab/jam/${jamCode}`);

export const joinJam = (jamCode: string, userId: string, displayName?: string) =>
  apiFetch<{ jamId: string; isHost: boolean }>(`/collab/jam/${jamCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, display_name: displayName }),
  });

export const updateJamState = (jamCode: string, hostId: string, state: {
  track_id?: string; track_title?: string; track_artist?: string; track_cover?: string;
  position_s: number; is_playing: boolean;
}) =>
  apiFetch<{ success: boolean }>(`/collab/jam/${jamCode}/state`, {
    method: 'PATCH',
    body: JSON.stringify({ host_id: hostId, ...state }),
  });

export const endJam = (jamCode: string, hostId: string) =>
  apiFetch<{ success: boolean }>(`/collab/jam/${jamCode}`, {
    method: 'DELETE',
    body: JSON.stringify({ host_id: hostId }),
  });

// ── Sinfonía Queue ─────────────────────────────────────────────────────────────

export interface JamQueueItem {
  id: string;
  jam_id: string;
  track_id: string;
  track_title: string;
  track_artist: string;
  track_cover: string | null;
  added_by: string;
  added_by_name: string;
  votes: number;
  position: number;
  added_at: string;
  voted?: boolean; // local flag
}

export const getJamQueue = (jamCode: string) =>
  apiFetch<JamQueueItem[]>(`/collab/jam/${jamCode}/queue`);

export const addToJamQueue = (jamCode: string, data: {
  track_id: string; track_title: string; track_artist: string;
  track_cover?: string; added_by: string; added_by_name?: string;
}) =>
  apiFetch<JamQueueItem>(`/collab/jam/${jamCode}/queue`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const removeFromJamQueue = (jamCode: string, itemId: string, userId: string) =>
  apiFetch<{ success: boolean }>(`/collab/jam/${jamCode}/queue/${itemId}`, {
    method: 'DELETE',
    body: JSON.stringify({ user_id: userId }),
  });

export const voteJamQueueItem = (jamCode: string, itemId: string, userId: string) =>
  apiFetch<{ voted: boolean }>(`/collab/jam/${jamCode}/queue/${itemId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId }),
  });

export const updateJamSettings = (jamCode: string, hostId: string, settings: {
  anyone_can_add?: boolean; queue_enabled?: boolean;
}) =>
  apiFetch<{ success: boolean }>(`/collab/jam/${jamCode}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ host_id: hostId, ...settings }),
  });

// ── Custom Tracks ─────────────────────────────────────────────────────────────
export const getCustomTracks = () => apiFetch<Track[]>('/tracks/custom');

export const uploadCustomTrack = (formData: FormData) => {
  return fetch(`${BASE}/tracks/upload`, {
    method: 'POST',
    body: formData,
  }).then(async (res) => {
    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(error.error ?? 'Error al subir el archivo');
    }
    return res.json() as Promise<Track>;
  });
};

export const deleteCustomTrack = (id: string) =>
  apiFetch<{ success: boolean }>(`/tracks/custom/${id}`, { method: 'DELETE' });

// ── Friends & Social ──────────────────────────────────────────────────────────

export interface KokoProfile {
  id: string;
  username?: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  is_public?: boolean;
  created_at?: string;
  email?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanName(name?: string, fallback = 'Kokoer'): string {
  if (!name) return fallback;
  const t = name.trim();
  if (UUID_RE.test(t)) return fallback;
  if (t.includes('@')) return t.split('@')[0];
  return t;
}

export function getProfileNames(profile?: { username?: string; display_name?: string } | null, fallback = 'Kokoer') {
  if (!profile) return { primary: fallback, secondary: '' };
  
  const usernameClean = profile.username ? cleanName(profile.username, '') : '';
  const displayClean = profile.display_name ? cleanName(profile.display_name, '') : '';

  if (usernameClean) {
    return {
      primary: `@${usernameClean}`,
      secondary: displayClean && displayClean !== usernameClean ? displayClean : ''
    };
  }
  
  return {
    primary: displayClean || fallback,
    secondary: ''
  };
}

export interface Friendship {
  friendshipId: string;
  id: string;
  username?: string;
  display_name: string;
  avatar_url?: string;
  bio?: string;
  since: string;
  unreadCount?: number;
}

export interface FriendRequest {
  requestId: string;
  id: string;
  username?: string;
  display_name: string;
  avatar_url?: string;
  sentAt: string;
}

export interface KokoMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export const searchUsers = (q: string, userId: string) =>
  apiFetch<{ users: KokoProfile[] }>(`/friends/users/search?q=${encodeURIComponent(q)}&userId=${encodeURIComponent(userId)}`);

export const getFriends = (userId: string) =>
  apiFetch<{ friends: Friendship[] }>(`/friends?userId=${encodeURIComponent(userId)}`);

export const getFriendRequests = (userId: string) =>
  apiFetch<{ requests: FriendRequest[] }>(`/friends/requests?userId=${encodeURIComponent(userId)}`);

export const sendFriendRequest = (requesterId: string, addresseeId: string) =>
  apiFetch<{ friendship: any }>('/friends/request', {
    method: 'POST',
    body: JSON.stringify({ requesterId, addresseeId }),
  });

export const respondFriendRequest = (requestId: string, userId: string, action: 'accept' | 'reject') =>
  apiFetch<{ success: boolean; status: string }>(`/friends/request/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ userId, action }),
  });

export const removeFriend = (userId: string, friendId: string) =>
  apiFetch<{ success: boolean }>(`/friends/${friendId}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });

export const getMessages = (userId: string, friendId: string, before?: string) =>
  apiFetch<{ messages: KokoMessage[] }>(
    `/friends/messages/${friendId}?userId=${encodeURIComponent(userId)}${before ? `&before=${encodeURIComponent(before)}` : ''}`
  );

export const sendMessage = (senderId: string, receiverId: string, content: string) =>
  apiFetch<{ message: KokoMessage }>('/friends/messages', {
    method: 'POST',
    body: JSON.stringify({ senderId, receiverId, content }),
  });

export const getFriendProfile = (userId: string, myId?: string) =>
  apiFetch<{ profile: KokoProfile; stats: { artistFollowsCount: number; commonPlaylists?: any[]; listeningStats?: any } }>(
    `/friends/profile/${userId}${myId ? `?myId=${encodeURIComponent(myId)}` : ''}`
  );

export const getFriendArtists = (userId: string) =>
  apiFetch<{ artists: any[] }>(`/friends/profile/${userId}/artists`);

export const getFriendshipStatus = (userId: string, targetId: string) =>
  apiFetch<{ status: 'none' | 'pending' | 'accepted' | 'blocked'; friendshipId?: string; isSender?: boolean }>(
    `/friends/status?userId=${encodeURIComponent(userId)}&targetId=${encodeURIComponent(targetId)}`
  );

export const updateProfile = (userId: string, data: Partial<KokoProfile>) =>
  apiFetch<{ profile: KokoProfile }>('/friends/profile', {
    method: 'PATCH',
    body: JSON.stringify({ userId, ...data }),
  });

export const getMyProfile = (userId: string) =>
  apiFetch<{ profile: KokoProfile; stats: any }>(`/friends/profile/${userId}`);

export const getAvailableAccounts = () =>
  apiFetch<{ accounts: KokoProfile[] }>('/friends/accounts');

export const deleteAccount = (userId: string, usernameConfirm: string) =>
  apiFetch<{ success: boolean; message: string }>(`/friends/profile/${userId}`, {
    method: 'DELETE',
    body: JSON.stringify({ usernameConfirm }),
  });

export const uploadAvatar = async (file: File): Promise<{ avatarUrl: string }> => {
  const formData = new FormData();
  formData.append('avatar', file);
  const res = await fetch(`${BASE}/friends/profile/avatar`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error ?? 'Error al subir la imagen de perfil');
  }
  return res.json();
};

export const inviteFriendsToCollab = (code: string, senderId: string, senderName: string, friendIds: string[]) =>
  apiFetch<{ success: boolean }>(`/collab/playlists/${code}/invite`, {
    method: 'POST',
    body: JSON.stringify({ senderId, senderName, friendIds }),
  });

export const respondCollabInvitation = (id: string, action: 'accept' | 'reject', userId: string, displayName: string) =>
  apiFetch<{ success: boolean }>(`/collab/invitations/${id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ action, userId, displayName }),
  });

export const getNotifications = (userId: string) =>
  apiFetch<{ notifications: any[] }>(`/artist/notifications${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`);

export const markNotificationsRead = (userId: string) =>
  apiFetch<{ success: boolean }>(`/artist/notifications/read?userId=${encodeURIComponent(userId)}`, {
    method: 'POST',
  });

export function resolveImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/') && !url.startsWith('//')) {
    const apiBase = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
    const domain = apiBase.replace('/api', '');
    return `${domain}${url}`;
  }
  return url;
}


