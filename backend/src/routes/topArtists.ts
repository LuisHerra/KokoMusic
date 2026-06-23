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

async function getLastFmTopArtists(country: string, limit = 50): Promise<any[]> {
  const method = country === 'global' ? 'chart.gettopartists' : 'geo.gettopartists';
  const extra = country !== 'global' ? `&country=${encodeURIComponent(country)}` : '';
  const url = `${LFM}/?method=${method}&api_key=${LFM_KEY}&format=json&limit=${limit}${extra}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm error: ${res.status}`);
  const data = (await res.json()) as any;
  const artists: any[] = data.artists?.artist || data.topartists?.artist || [];
  return artists;
}

async function enrichWithDeezer(name: string): Promise<{ image: string; deezerId?: number; nb_fan?: number } | null> {
  try {
    const res = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=3`);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!data.data?.length) return null;
    const match = data.data.find((x: any) => x.name.toLowerCase() === name.toLowerCase()) || data.data[0];
    return {
      image: match.picture_xl || match.picture_medium || match.picture || '',
      deezerId: match.id,
      nb_fan: match.nb_fan || 0,
    };
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  const country = (req.query.country as string) || 'global';
  const sort = (req.query.sort as string) || 'mensual';
  const cacheKey = `top-${country}-${sort}`;

  const cached = fromCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    if (!LFM_KEY) throw new Error('No LASTFM_KEY configured');

    // 1. Obtener ranking desde Last.fm (datos reales)
    const lfmArtists = await getLastFmTopArtists(country, 50);

    // 2. Enriquecer con imágenes de Deezer en paralelo (lotes de 10 para no saturar)
    const BATCH = 10;
    const enriched: any[] = [];
    for (let i = 0; i < Math.min(lfmArtists.length, 50); i += BATCH) {
      const batch = lfmArtists.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (a, batchIdx) => {
          const dz = await enrichWithDeezer(a.name);
          const lfmListeners = parseInt(a.listeners || '0', 10);
          const dzFans = dz?.nb_fan || 0;
          let finalListeners = lfmListeners;
          if (sort === 'mensual') {
            finalListeners = dzFans > 0 ? Math.round(dzFans * 8) : lfmListeners;
          }

          return {
            position: i + batchIdx + 1,
            name: a.name,
            listeners: finalListeners,
            playcount: parseInt(a.playcount || '0', 10),
            image: dz?.image || '',
            deezerId: dz?.deezerId,
            url: a.url || '',
            dzFans: dzFans,
          };
        })
      );
      enriched.push(...results);
    }

    if (sort === 'mensual') {
      enriched.sort((a, b) => b.dzFans - a.dzFans);
      enriched.forEach((artist, idx) => artist.position = idx + 1);
    }

    const payload = { artists: enriched };
    toCache(cacheKey, payload);
    res.json(payload);
  } catch (error) {
    console.error('[Top Artists] Error:', error);
    res.status(500).json({ error: 'Failed to fetch top artists' });
  }
});

export default router;
