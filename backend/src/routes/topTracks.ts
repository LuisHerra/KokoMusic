import { Router } from 'express';

const router = Router();
const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM = 'https://ws.audioscrobbler.com/2.0';

// In-memory cache: 30 min TTL
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

function fromCache(key: string) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}
function toCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

async function getLastFmTopTracks(country: string, limit = 50): Promise<any[]> {
  const method = country === 'global' ? 'chart.gettoptracks' : 'geo.gettoptracks';
  const extra = country !== 'global' ? `&country=${encodeURIComponent(country)}` : '';
  const url = `${LFM}/?method=${method}&api_key=${LFM_KEY}&format=json&limit=${limit}${extra}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm error: ${res.status}`);
  const data = (await res.json()) as any;
  return data.tracks?.track || [];
}

async function enrichWithDeezer(artist: string, trackName: string): Promise<{ image: string; albumName?: string; duration?: number; rank?: number } | null> {
  try {
    const res = await fetch(`https://api.deezer.com/search/track?q=artist:"${encodeURIComponent(artist)}" track:"${encodeURIComponent(trackName)}"&limit=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data.data?.length) return null;
    const match = data.data[0];
    return {
      image: match.album?.cover_xl || match.album?.cover_medium || match.album?.cover || '',
      albumName: match.album?.title,
      duration: match.duration,
      rank: match.rank || 0,
    };
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  const country = (req.query.country as string) || 'global';
  const sort = (req.query.sort as string) || 'mensual';
  const cacheKey = `top-tracks-${country}-${sort}`;

  const cached = fromCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    if (!LFM_KEY) throw new Error('No LASTFM_KEY configured');

    const lfmTracks = await getLastFmTopTracks(country, 50);

    const BATCH = 10;
    const enriched: any[] = [];
    for (let i = 0; i < Math.min(lfmTracks.length, 50); i += BATCH) {
      const batch = lfmTracks.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (t, batchIdx) => {
          const artistName = t.artist?.name || '';
          const dz = await enrichWithDeezer(artistName, t.name);
          const lfmListeners = parseInt(t.listeners || '0', 10);
          let finalListeners = lfmListeners;
          if (sort === 'mensual') {
            finalListeners = dz?.rank ? Math.round(dz.rank * 1.5) : lfmListeners;
          }

          return {
            position: i + batchIdx + 1,
            id: t.mbid || `${artistName}-${t.name}`,
            title: t.name,
            artistName: artistName,
            playcount: parseInt(t.playcount || '0', 10),
            listeners: finalListeners,
            image: dz?.image || '',
            albumName: dz?.albumName || 'Unknown Album',
            duration: dz?.duration || 0,
            url: t.url || '',
            dzRank: dz?.rank || 0,
          };
        })
      );
      enriched.push(...results);
    }

    if (sort === 'mensual') {
      enriched.sort((a, b) => b.dzRank - a.dzRank);
      enriched.forEach((track, idx) => track.position = idx + 1);
    }

    const payload = { tracks: enriched };
    toCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error('[Top Tracks] Error:', error);
    res.status(500).json({ error: 'Failed to fetch top tracks' });
  }
});

export default router;
