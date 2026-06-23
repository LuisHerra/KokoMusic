/**
 * Follow Service — KokoMusic 4b
 *
 * Stores followed artists in Supabase `kokomusic.follows`.
 * Background job checks for new releases every 6h and writes
 * notifications to `kokomusic.notifications`.
 */

import { supabase } from './supabaseService';

export interface FollowedArtist {
  artistId: number;
  artistName: string;
  artistImage?: string;
  followedAt: string;
  lastReleaseDate?: string;
}

export interface Notification {
  id: string;
  type: string;
  artistId?: number;
  artistName?: string;
  message: string;
  trackName?: string;
  coverUrl?: string;
  isRead: boolean;
  createdAt: string;
  playlistCode?: string;
  senderName?: string;
  status?: string;
  userId?: string;
}

// ── Follow CRUD ───────────────────────────────────────────────────────────────

export async function getFollows(userId: string): Promise<FollowedArtist[]> {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .schema('kokomusic')
    .from('follows')
    .select('*')
    .eq('user_id', userId)
    .order('followed_at', { ascending: false });
  if (error) {
    console.error('[Follows] Error reading follows for user:', userId, error.message);
    return [];
  }
  return (data || []).map(row => ({
    artistId: row.artist_id,
    artistName: row.artist_name,
    artistImage: row.artist_image,
    followedAt: row.followed_at,
    lastReleaseDate: row.last_release_date,
  }));
}

export async function getFollowStatus(userId: string, artistId: number): Promise<boolean> {
  if (!supabase || !userId) return false;
  const { data } = await supabase
    .schema('kokomusic')
    .from('follows')
    .select('artist_id')
    .eq('user_id', userId)
    .eq('artist_id', artistId)
    .single();
  return !!data;
}

export async function followArtist(
  userId: string,
  artistId: number,
  artistName: string,
  artistImage?: string,
  lastReleaseDate?: string
): Promise<void> {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('follows')
    .upsert(
      {
        user_id: userId,
        artist_id: artistId,
        artist_name: artistName,
        artist_image: artistImage || null,
        followed_at: new Date().toISOString(),
        last_release_date: lastReleaseDate || null,
      },
      { onConflict: 'user_id,artist_id' }
    );
  if (error) console.error('[Follows] Error following artist:', error.message);
}

export async function unfollowArtist(userId: string, artistId: number): Promise<void> {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('follows')
    .delete()
    .eq('user_id', userId)
    .eq('artist_id', artistId);
  if (error) console.error('[Follows] Error unfollowing artist:', error.message);
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function getNotifications(userId?: string, limit = 30): Promise<Notification[]> {
  if (!supabase) return [];
  let query = supabase
    .schema('kokomusic')
    .from('notifications')
    .select('*');

  if (userId) {
    query = query.or(`user_id.is.null,user_id.eq.${userId}`);
  } else {
    query = query.is('user_id', null);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Notifications] Error reading:', error.message);
    return [];
  }
  return (data || []).map(row => ({
    id: row.id,
    type: row.type,
    artistId: row.artist_id,
    artistName: row.artist_name,
    message: row.message,
    trackName: row.track_name,
    coverUrl: row.cover_url,
    isRead: row.is_read,
    createdAt: row.created_at,
    playlistCode: row.playlist_code,
    senderName: row.sender_name,
    status: row.status,
    userId: row.user_id,
  }));
}

export async function markNotificationsRead(userId?: string): Promise<void> {
  if (!supabase) return;
  let query = supabase
    .schema('kokomusic')
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false);
  
  if (userId) {
    query = query.or(`user_id.is.null,user_id.eq.${userId}`);
  } else {
    query = query.is('user_id', null);
  }

  await query;
}

async function pushNotification(
  artistId: number,
  artistName: string,
  trackName: string,
  coverUrl?: string
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('notifications')
    .insert({
      type: 'new_release',
      artist_id: artistId,
      artist_name: artistName,
      message: `${artistName} lanzó "${trackName}"`,
      track_name: trackName,
      cover_url: coverUrl || null,
    });
  if (error) console.error('[Notifications] Error inserting:', error.message);
}

// ── Background Release Checker ────────────────────────────────────────────────

let releaseCheckerInterval: ReturnType<typeof setInterval> | null = null;

async function checkFollowedArtistReleases(): Promise<void> {
  if (!supabase) return;

  // Retrieve unique artists that are followed by any user
  const { data: dbFollows, error } = await supabase
    .schema('kokomusic')
    .from('follows')
    .select('artist_id, artist_name, last_release_date');

  if (error || !dbFollows || dbFollows.length === 0) return;

  // Deduplicate by artist_id
  const uniqueArtistsMap: Record<number, { artistId: number; artistName: string; lastReleaseDate?: string }> = {};
  for (const row of dbFollows) {
    const aid = Number(row.artist_id);
    if (!uniqueArtistsMap[aid]) {
      uniqueArtistsMap[aid] = {
        artistId: aid,
        artistName: row.artist_name,
        lastReleaseDate: row.last_release_date,
      };
    }
  }

  const artistsToCheck = Object.values(uniqueArtistsMap);
  console.log(`[FollowService] Checking releases for ${artistsToCheck.length} unique followed artists...`);

  for (const artist of artistsToCheck) {
    try {
      // Query iTunes RSS for the artist's latest release
      const url = `https://itunes.apple.com/lookup?id=${artist.artistId}&entity=album&limit=1&sort=recent`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as any;

      const latestAlbum = data.results?.find((r: any) => r.wrapperType === 'collection');
      if (!latestAlbum) continue;

      const releaseDate = latestAlbum.releaseDate as string;
      const trackName = latestAlbum.collectionName as string;
      const coverUrl = latestAlbum.artworkUrl100?.replace(/\d+x\d+bb\.jpg$/, '300x300bb.jpg') as string;

      // Compare with stored last_release_date
      if (!artist.lastReleaseDate || new Date(releaseDate) > new Date(artist.lastReleaseDate)) {
        console.log(`[FollowService] New release from ${artist.artistName}: "${trackName}"`);
        await pushNotification(artist.artistId, artist.artistName, trackName, coverUrl);

        // Update last_release_date for all records of this artist across all users
        await supabase
          .schema('kokomusic')
          .from('follows')
          .update({ last_release_date: releaseDate })
          .eq('artist_id', artist.artistId);
      }
    } catch (err) {
      console.error(`[FollowService] Error checking releases for ${artist.artistName}:`, err);
    }
  }
}

export function startReleaseChecker(): void {
  if (releaseCheckerInterval) return;

  // Run once after 30s on startup (avoids startup noise)
  setTimeout(() => checkFollowedArtistReleases(), 30_000);

  // Then every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  releaseCheckerInterval = setInterval(() => checkFollowedArtistReleases(), SIX_HOURS);

  console.log('[FollowService] Release checker started (interval: 6h)');
}
