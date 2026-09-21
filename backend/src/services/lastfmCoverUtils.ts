/**
 * lastfmCoverUtils.ts
 *
 * Last.fm dejó de servir imágenes reales hace años — casi todo lo que
 * devuelve es un placeholder genérico fijo (mismo hash siempre). Este
 * módulo centraliza su detección y el fallback a iTunes para resolver
 * una portada real, compartido entre candidateGenerator, backgroundJobRunner
 * y trendingService (antes triplicado en los tres).
 */

const LASTFM_PLACEHOLDER_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

export function isLastfmPlaceholderCover(url: string | null | undefined): boolean {
  return !url || url.includes(LASTFM_PLACEHOLDER_HASH);
}

const itunesCoverCache = new Map<string, { cover: string; genre: string; ts: number }>();
const ITUNES_COVER_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

/** Resuelve portada real + género vía iTunes Search cuando Last.fm no tiene imagen. Cachea 7 días. */
export async function lookupItunesCoverAndGenre(artist: string, title: string): Promise<{ cover: string; genre: string }> {
  const cacheKey = `${artist.toLowerCase().trim()}::${title.toLowerCase().trim()}`;
  const cached = itunesCoverCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ITUNES_COVER_CACHE_TTL) return cached;

  let cover = '';
  let genre = 'Otros';
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&media=music&entity=musicTrack&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as any;
      const match = data?.results?.[0];
      if (match) {
        cover = (match.artworkUrl100 as string || '').replace(/\d+x\d+bb\.jpg$/, '600x600bb.jpg');
        genre = match.primaryGenreName || 'Otros';
      }
    }
  } catch (err) {
    console.error(`[Charts] iTunes cover lookup error for "${artist} - ${title}":`, err);
  }

  const result = { cover, genre };
  itunesCoverCache.set(cacheKey, { ...result, ts: Date.now() });
  return result;
}
