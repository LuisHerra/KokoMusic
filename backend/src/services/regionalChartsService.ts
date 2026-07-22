/**
 * regionalChartsService.ts — Real-time Country & Language Specific Music Charts
 *
 * Integrates:
 *   1. iTunes Regional RSS Charts (Official Top 50 by country code: es, mx, ar, co, us, gb, etc.)
 *   2. Last.fm Geo Top Tracks API (geo.gettoptracks by country name)
 *
 * Serves localized trending candidates for KokoMusic's recommendation engine.
 */

import { cache } from './cacheService';
import { getRegionISOCode } from './regionService';
import type { TrackMetadata } from './metadataService';

const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

const CHART_CACHE_TTL = 30 * 60; // 30 minutes in seconds

/** Fetches official iTunes Top 50 songs for a specific country ISO code */
export async function fetchItunesRegionalTopChart(isoCode: string): Promise<TrackMetadata[]> {
  const cacheKey = `chart:itunes:${isoCode}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  try {
    const url = `https://itunes.apple.com/${isoCode.toLowerCase()}/rss/topsongs/limit=50/json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const entries = data?.feed?.entry;

    if (!Array.isArray(entries)) return [];

    const tracks: TrackMetadata[] = entries.map((entry: any) => {
      const itunesId = entry?.id?.attributes?.['im:id']
        ? parseInt(entry.id.attributes['im:id'], 10)
        : 0;
      const title = entry?.['im:name']?.label || 'Desconocido';
      const artist = entry?.['im:artist']?.label || 'Artista Desconocido';
      const cover = entry?.['im:image']?.[2]?.label || entry?.['im:image']?.[0]?.label || '';
      const genre = entry?.category?.attributes?.label || 'Top Trending';

      return {
        id: String(itunesId || Math.abs(stringHash(`${artist}-${title}`))),
        itunesId,
        artistId: 0,
        title,
        artist,
        album: entry?.['im:collection']?.['im:name']?.label || 'Top Charts',
        cover,
        duration: 180000,
        genre,
        releaseDate: null,
        popularity: 95,
        preview_url: entry?.link?.[1]?.attributes?.href || null,
      };
    });

    if (tracks.length > 0) {
      cache.setex(cacheKey, CHART_CACHE_TTL, JSON.stringify(tracks));
    }
    return tracks;
  } catch (err) {
    console.error(`[RegionalCharts] Error fetching iTunes RSS chart for ${isoCode}:`, err);
    return [];
  }
}

/** Fetches Last.fm Geo Top Tracks for a country name */
export async function fetchLastFmGeoTopTracks(countryName: string, limit = 30): Promise<TrackMetadata[]> {
  if (!LFM_KEY) return [];

  const cacheKey = `chart:lastfm:geo:${countryName.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  try {
    const url = `${LFM_BASE}?method=geo.gettoptracks&country=${encodeURIComponent(countryName)}&api_key=${LFM_KEY}&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const rawTracks = data?.toptracks?.track;

    if (!Array.isArray(rawTracks)) return [];

    const tracks: TrackMetadata[] = rawTracks.map((t: any) => {
      const title = t.name || '';
      const artist = typeof t.artist === 'string' ? t.artist : t.artist?.name || '';
      const cover = t.image?.[2]?.['#text'] || t.image?.[0]?.['#text'] || '';

      return {
        id: String(Math.abs(stringHash(`lastfm-${artist}-${title}`))),
        itunesId: 0,
        artistId: 0,
        title,
        artist,
        album: 'Éxitos Regionales',
        cover,
        duration: 180000,
        genre: 'Regional Top',
        releaseDate: null,
        popularity: 90,
        preview_url: null,
      };
    });

    if (tracks.length > 0) {
      cache.setex(cacheKey, CHART_CACHE_TTL, JSON.stringify(tracks));
    }
    return tracks;
  } catch (err) {
    console.error(`[RegionalCharts] Error fetching Last.fm Geo chart for ${countryName}:`, err);
    return [];
  }
}

/** Aggregate regional top charts combining iTunes RSS and Last.fm Geo */
export async function getRegionalTopTracks(region = 'spain'): Promise<TrackMetadata[]> {
  const isoCode = getRegionISOCode(region);
  const [itunesCharts, lastfmGeoCharts] = await Promise.all([
    fetchItunesRegionalTopChart(isoCode),
    fetchLastFmGeoTopTracks(region, 25),
  ]);

  const combined = new Map<string, TrackMetadata>();
  [...itunesCharts, ...lastfmGeoCharts].forEach((track) => {
    const key = `${track.artist.toLowerCase().trim()}-${track.title.toLowerCase().trim()}`;
    if (!combined.has(key)) {
      combined.set(key, track);
    }
  });

  return Array.from(combined.values());
}

function stringHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash);
}
