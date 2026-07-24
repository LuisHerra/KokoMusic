/**
 * listenBrainzService.ts — Open-Source ListenBrainz Recommendation API Integration
 *
 * Integrates open collaborative filtering and acoustic recording similarities
 * from MusicBrainz / ListenBrainz (MetaBrainz Foundation).
 *
 * Two modes:
 *  1. Sitewide top recordings (global fallback / cold-start)
 *  2. User-specific CF recommendations (via /cf/recommendation/user/{username}/recording)
 *     Requires the user to have a ListenBrainz account. MBIDs are resolved to
 *     artist+title via the MusicBrainz API (1 req/s, no auth needed).
 */

import { cache } from './cacheService';

const LB_BASE = 'https://api.listenbrainz.org/1';
const MB_BASE = 'https://musicbrainz.org/ws/2';
const MB_USER_AGENT = 'KokoMusic/1.0 (https://github.com/KokoWorks/KokoMusic)';

export interface ListenBrainzRecording {
  trackName: string;
  artistName: string;
}

export interface ListenBrainzCFRecording {
  recording_mbid: string;
  score: number;
}

/** Fetches sitewide top recordings from ListenBrainz open stats */
export async function getListenBrainzTopRecordings(limit = 25): Promise<ListenBrainzRecording[]> {
  const cacheKey = `lb:toprecordings:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  try {
    const url = `${LB_BASE}/stats/sitewide/recordings?count=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const payload = data?.payload?.recordings;

    if (!Array.isArray(payload)) return [];

    const results: ListenBrainzRecording[] = payload.map((r: any) => ({
      trackName: r.track_name || '',
      artistName: r.artist_name || '',
    })).filter((r) => r.trackName && r.artistName);

    if (results.length > 0) {
      cache.setex(cacheKey, 3600 * 12, JSON.stringify(results));
    }
    return results;
  } catch (err) {
    console.error('[ListenBrainz] Error fetching sitewide recordings:', err);
    return [];
  }
}

/**
 * Fetches user-specific collaborative filtering recommendations from ListenBrainz.
 * Requires the user to have a public ListenBrainz account (username).
 * MBIDs are resolved to artist+title via the MusicBrainz API.
 * Results are cached for 6 hours per user.
 *
 * @param lbUsername - ListenBrainz username
 * @param limit - max recommendations to return (after MBID resolution)
 * @returns resolved track name + artist pairs, or [] if unavailable
 */
export async function getUserCFRecommendations(
  lbUsername: string,
  limit = 15
): Promise<ListenBrainzRecording[]> {
  if (!lbUsername) return [];

  const cacheKey = `lb:cf:${lbUsername}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  try {
    // Step 1: Fetch CF recommended recording MBIDs
    const cfUrl = `${LB_BASE}/cf/recommendation/user/${encodeURIComponent(lbUsername)}/recording?count=${limit * 2}`;
    const cfRes = await fetch(cfUrl, {
      headers: { 'User-Agent': MB_USER_AGENT }
    });

    if (!cfRes.ok) {
      console.warn(`[ListenBrainz] CF recommendations for user '${lbUsername}' returned ${cfRes.status}`);
      return [];
    }

    const cfData = (await cfRes.json()) as any;
    const mbids: ListenBrainzCFRecording[] = cfData?.payload?.mbids || [];

    if (!mbids.length) return [];

    // Step 2: Resolve top-scored MBIDs → artist + title via MusicBrainz API
    // Rate limit: 1 req/s — we batch with delay to respect it
    const topMbids = mbids
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(limit, 10)); // resolve at most 10 to stay within rate limit

    const resolved: ListenBrainzRecording[] = [];

    for (const { recording_mbid } of topMbids) {
      try {
        const mbUrl = `${MB_BASE}/recording/${recording_mbid}?fmt=json`;
        const mbRes = await fetch(mbUrl, {
          headers: { 'User-Agent': MB_USER_AGENT }
        });
        if (!mbRes.ok) continue;

        const mbData = (await mbRes.json()) as any;
        const title = mbData?.title;
        const artistCredit = mbData?.['artist-credit']?.[0];
        const artist = artistCredit?.artist?.name || artistCredit?.name;

        if (title && artist) {
          resolved.push({ trackName: title, artistName: artist });
        }
      } catch {
        // Ignore individual MBID resolution failures
      }

      // Respect MusicBrainz 1 req/s rate limit
      await new Promise(r => setTimeout(r, 1100));
    }

    if (resolved.length > 0) {
      // Cache for 6 hours — CF recs don't change that fast
      cache.setex(cacheKey, 3600 * 6, JSON.stringify(resolved));
      console.log(`[ListenBrainz] CF resolved ${resolved.length}/${topMbids.length} tracks for user '${lbUsername}'`);
    }

    return resolved;
  } catch (err) {
    console.error('[ListenBrainz] Error fetching user CF recommendations:', err);
    return [];
  }
}

/**
 * Fetches a user's top artists from ListenBrainz for taste profile enrichment.
 * Useful when a new user has a LB account but no local history yet.
 *
 * @param lbUsername - ListenBrainz username
 * @param range - 'week' | 'month' | 'year' | 'all_time'
 */
export async function getUserTopArtists(
  lbUsername: string,
  range: 'week' | 'month' | 'year' | 'all_time' = 'month'
): Promise<string[]> {
  if (!lbUsername) return [];

  const cacheKey = `lb:topartists:${lbUsername}:${range}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  try {
    const url = `${LB_BASE}/stats/user/${encodeURIComponent(lbUsername)}/artists?count=20&range=${range}`;
    const res = await fetch(url, { headers: { 'User-Agent': MB_USER_AGENT } });
    if (!res.ok) return [];

    const data = (await res.json()) as any;
    const artists: string[] = (data?.payload?.artists || [])
      .map((a: any) => a.artist_name || '')
      .filter(Boolean);

    if (artists.length > 0) {
      cache.setex(cacheKey, 3600 * 3, JSON.stringify(artists));
    }
    return artists;
  } catch (err) {
    console.error('[ListenBrainz] Error fetching user top artists:', err);
    return [];
  }
}
