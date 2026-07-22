/**
 * listenBrainzService.ts — Open-Source ListenBrainz Recommendation API Integration
 *
 * Integrates open collaborative filtering and acoustic recording similarities
 * from MusicBrainz / ListenBrainz (MetaBrainz Foundation).
 */

import { cache } from './cacheService';

const LB_BASE = 'https://api.listenbrainz.org/1';

export interface ListenBrainzRecording {
  trackName: string;
  artistName: string;
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
