/**
 * Artist Service — refactorizado con iTunes Search API
 *
 * Estrategia de caché:
 *   Metadata artista: L1 (1h) → L2 Supabase (30 días) → iTunes + Wikipedia
 *   Top tracks:       se obtienen de metadataService.getArtistTopTracks
 */

import { cache } from './cacheService';
import { getArtistTopTracks } from './metadataService';
import { getArtistFromDB, upsertArtist, type ArtistRow } from './supabaseService';

export interface ArtistInfo {
  itunesArtistId: number;
  name: string;
  bio: string;
  image: string;
  genre: string;
  topTracks: any[];
  albums: any[];
  musicVideos?: any[];
  livePerformances?: any[];
  monthlyListeners?: number;
  fanart?: string;
  gallery?: string[];
  socialLinks?: { twitter?: string; facebook?: string; website?: string; youtube?: string; instagram?: string; spotify?: string };
  isVerified?: boolean;
  playcount?: number;
  events?: { name?: string; date: string; time?: string; city: string; venue: string; country: string; url?: string; soldOut?: boolean; status?: string; image?: string }[];
  merch?: { name: string; url: string; image?: string; price?: string }[];
  similarArtists?: { name: string; image?: string; url?: string }[];
}

export function hashStringToInteger(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Construye un ArtistInfo desde un canal de YouTube cuando iTunes no tiene datos.
 * Busca vídeos del canal con yt-search y los convierte en "canciones" / top content.
 */
async function buildArtistInfoFromYouTube(channelName: string): Promise<ArtistInfo | null> {
  const { searchYtdlp } = await import('./ytdlpSearchService');

  try {
    // Buscar vídeos del canal como top tracks via yt-dlp
    const channelVideos = await searchYtdlp(`${channelName} official`, 20);

    if (channelVideos.length === 0) return null;

    const channelImage = channelVideos[0]?.thumbnail || '';
    const channelUrl = `https://www.youtube.com/@${encodeURIComponent(channelName)}`;
    const resolvedArtistName = channelName;
    const artistId = hashStringToInteger(resolvedArtistName);

    // Convertir vídeos a "tracks" con itunesId=0 (ID de YouTube directo)
    const topTracks = channelVideos.map((v: any, idx: number) => ({
      id: v.videoId,
      itunesId: 0,
      artistId: artistId,
      title: v.title ?? 'Sin título',
      artist: resolvedArtistName,
      album: 'YouTube',
      cover: v.thumbnail ?? channelImage,
      duration: (v.duration?.seconds ?? 0) * 1000,
      genre: '',
      releaseDate: null,
      popularity: v.views || (1000 - idx),
      preview_url: null,
    }));

    // Buscar vídeos más recientes como "musicVideos"
    const recentVideos = await searchYtdlp(`${channelName} latest`, 6);
    const musicVideos = recentVideos.map((v: any) => ({
      id: v.videoId,
      title: v.title,
      thumbnail: v.thumbnail,
      views: v.views,
      duration: v.duration?.seconds ? `${Math.floor(v.duration.seconds / 60)}:${String(v.duration.seconds % 60).padStart(2, '0')}` : '',
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));

    const artistInfo: ArtistInfo = {
      itunesArtistId: artistId,
      name: resolvedArtistName,
      bio: `Canal de YouTube de ${resolvedArtistName}. Contenido disponible en YouTube.`,
      image: channelImage,
      genre: 'YouTube',
      topTracks,
      albums: [],
      musicVideos,
      livePerformances: [],
      monthlyListeners: 0,
      playcount: 0,
      fanart: '',
      gallery: [],
      socialLinks: {
        youtube: channelUrl,
        twitter: `https://twitter.com/search?q=${encodeURIComponent(resolvedArtistName)}`,
        instagram: `https://www.instagram.com/explore/tags/${encodeURIComponent(resolvedArtistName.replace(/\s+/g, ''))}/`,
      },
      isVerified: false,
      events: [],
      merch: [],
      similarArtists: [],
    };

    // Guardar en Supabase para futuras búsquedas L2
    await upsertArtist({
      itunes_artist_id: artistId,
      name: resolvedArtistName,
      genre: 'YouTube',
      bio: artistInfo.bio,
      image_url: channelImage,
      updated_at: new Date().toISOString()
    });

    console.log(`[Artist] Canal de YouTube construido: ${artistInfo.name} (${artistInfo.topTracks.length} vídeos)`);
    return artistInfo;
  } catch (err) {
    console.error('[Artist] Error construyendo perfil desde YouTube:', err);
    return null;
  }
}

/**
 * Obtiene info de un artista por su iTunes Artist ID o nombre.
 * Imagen: cover del álbum más reciente (artworkUrl de iTunes lookup).
 * Bio: Wikipedia o Last.fm (fallback a "Biografía no disponible").
 * Si iTunes no encuentra el artista → fallback a canal de YouTube.
 */
export async function getArtistInfo(artistIdentifier: number | string): Promise<ArtistInfo | null> {
  let artistId = typeof artistIdentifier === 'number' ? artistIdentifier : 0;
  let searchName = typeof artistIdentifier === 'string' ? artistIdentifier : '';

  if (!artistId && searchName) {
    try {
      const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchName)}&entity=musicArtist&limit=1`);
      if (searchRes.ok) {
        const data = (await searchRes.json()) as any;
        const artist = data.results?.find((r: any) => r.wrapperType === 'artist');
        if (artist && artist.artistId) {
          artistId = artist.artistId;
        }
      }
    } catch (e) {
      console.error('[Artist] Error buscando artista por nombre:', e);
    }
  }

  // Si no pudimos resolver un ID numérico desde iTunes, intentar canal de YouTube
  if (!artistId) {
    if (searchName) {
      console.log(`[Artist] iTunes sin resultados para "${searchName}" → buscando canal de YouTube`);
      // Cache por nombre para evitar búsquedas repetidas
      const ytCacheKey = `artist-yt:${searchName.toLowerCase().replace(/\s+/g, '-')}`;
      const ytCached = cache.get(ytCacheKey);
      if (ytCached) return JSON.parse(ytCached);
      const ytInfo = await buildArtistInfoFromYouTube(searchName);
      if (ytInfo) {
        cache.setex(ytCacheKey, 3600 * 6, JSON.stringify(ytInfo)); // 6h cache
        return ytInfo;
      }
    }
    return null;
  }

  const cacheKey = `artist:${artistId}`;

  // L1: memoria (1h)
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // L2: Supabase (con TTL soft de 30 días)
  const fromDB = await getArtistFromDB(artistId);

  if (fromDB && fromDB.genre === 'YouTube') {
    console.log(`[Artist] Artista de YouTube detectado en DB: ${fromDB.name}`);
    const ytCacheKey = `artist-yt:${fromDB.name.toLowerCase().replace(/\s+/g, '-')}`;
    const ytCached = cache.get(ytCacheKey);
    if (ytCached) return JSON.parse(ytCached);
    const ytInfo = await buildArtistInfoFromYouTube(fromDB.name);
    if (ytInfo) {
      cache.setex(ytCacheKey, 3600 * 6, JSON.stringify(ytInfo));
      return ytInfo;
    }
  }

  let name = '';
  let bio = fromDB?.bio ?? '';
  let image = fromDB?.image_url ?? '';
  let genre = fromDB?.genre ?? '';

  console.log(`[Artist Debug] ID: ${artistId}, FromDB:`, !!fromDB);

  // Si no tenemos datos en Supabase o están desactualizados, hacemos lookup en iTunes
  if (!fromDB) {
    try {
      // Paso 1: obtener datos del artista (entity=musicArtist para el wrapperType=artist)
      const artistRes = await fetch(
        `https://itunes.apple.com/lookup?id=${artistId}&entity=musicArtist`
      );
      if (artistRes.ok) {
        const artistData = (await artistRes.json()) as any;
        const artistEntry = artistData.results?.find((r: any) => r.wrapperType === 'artist');
        console.log(`[Artist Debug] iTunes Artist Lookup - Results:`, artistData.results?.length);
        if (artistEntry) {
          name = artistEntry.artistName ?? '';
          genre = artistEntry.primaryGenreName ?? '';
          console.log(`[Artist Debug] Found Name: ${name}, Genre: ${genre}`);
        }
      } else {
        console.log(`[Artist Debug] iTunes Artist Lookup Failed with status: ${artistRes.status}`);
      }

      // Paso 2: obtener una canción para extraer el artwork del álbum
      const trackRes = await fetch(
        `https://itunes.apple.com/lookup?id=${artistId}&entity=song&limit=1`
      );
      if (trackRes.ok) {
        const trackData = (await trackRes.json()) as any;
        const firstTrack = trackData.results?.find((r: any) => r.wrapperType === 'track' && r.artworkUrl100);
        console.log(`[Artist Debug] iTunes Track Lookup - FirstTrack Found:`, !!firstTrack);
        if (firstTrack) {
          image = firstTrack.artworkUrl100.replace(/\d+x\d+bb\.jpg$/, '600x600bb.jpg');
          if (!name) {
            name = firstTrack.artistName ?? '';
            console.log(`[Artist Debug] Name fallback from track: ${name}`);
          }
          if (!genre) genre = firstTrack.primaryGenreName ?? '';
        }
      }
    } catch (err) {
      console.error('[Artist] Error en iTunes lookup:', err);
    }
  } else {
    name = fromDB.name;
    console.log(`[Artist Debug] Name from DB: ${name}`);
  }

  if (!name) {
    // iTunes lookup no produjo nombre — intentar canal de YouTube con el searchName original
    const fallbackName = searchName || String(artistId);
    if (fallbackName) {
      console.log(`[Artist] iTunes lookup sin nombre para ID ${artistId} → buscando canal de YouTube con "${fallbackName}"`);
      const ytCacheKey = `artist-yt:${fallbackName.toLowerCase().replace(/\s+/g, '-')}`;
      const ytCached = cache.get(ytCacheKey);
      if (ytCached) return JSON.parse(ytCached);
      const ytInfo = await buildArtistInfoFromYouTube(fallbackName);
      if (ytInfo) {
        cache.setex(ytCacheKey, 3600 * 6, JSON.stringify(ytInfo));
        return ytInfo;
      }
    }
    console.log(`[Artist Debug] Returning NULL because name is empty and YouTube fallback failed.`);
    return null;
  }

  let monthlyListeners = 0;
  let playcount = 0;
  let fanart = '';
  let gallery: string[] = [];
  let socialLinks: any = {};
  let merch: any[] = [];
  let events: any[] = [];

  // ── Todas las fuentes externas en paralelo (Promise.allSettled = nunca falla) ──
  const MB_UA = 'KokoMusic/1.0 ( kokoapps@kokoworks.dev )';
  const encodedName = encodeURIComponent(name);

  const [
    lfmResult,
    wikiResult,
    dzResult,
    adbResult,
    mbResult,
    tmResult,
    topTracksResult,
    albumsResult,
    ytResult,
  ] = await Promise.allSettled([
    // LastFM bio + stats
    process.env.LASTFM_KEY
      ? fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodedName}&api_key=${process.env.LASTFM_KEY}&lang=es&format=json`)
      : Promise.resolve(null),
    // Wikipedia fallback bio
    fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodedName}`),
    // Deezer image + fans
    fetch(`https://api.deezer.com/search/artist?q=${encodedName}`),
    // TheAudioDB fanart + socials
    fetch(`https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodedName}`),
    // MusicBrainz links (2 chained fetches handled below)
    fetch(`https://musicbrainz.org/ws/2/artist/?query=${encodedName}&limit=1&fmt=json`, { headers: { 'User-Agent': MB_UA } }),
    // Ticketmaster events
    process.env.TICKETMASTER_KEY
      ? fetch(`https://app.ticketmaster.com/discovery/v2/events.json?keyword=${encodedName}&size=10&sort=date,asc&classificationName=Music&apikey=${process.env.TICKETMASTER_KEY}`)
      : Promise.resolve(null),
    // iTunes top tracks
    getArtistTopTracks(artistId, 20),
    // iTunes albums
    fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200`),
    // YouTube videos (MV + live)
    import('./ytdlpSearchService').then(async ({ searchYtdlp }) => {
      const topTrackName = ''; // will be filled after topTracks resolves
      return Promise.all([
        searchYtdlp(`${name} official music video`, 6),
        searchYtdlp(`${name} live performance`, 4),
      ]);
    }),
  ]);

  // ── Process LastFM ──
  if (lfmResult.status === 'fulfilled' && lfmResult.value) {
    try {
      const res = lfmResult.value as Response;
      if (res.ok) {
        const lfmData = (await res.json()) as any;
        if (lfmData.artist) {
          if (!bio && lfmData.artist.bio?.content) {
            const cleanBio = lfmData.artist.bio.content
              .replace(/<a href="https:\/\/www\.last\.fm[^>]+>Read more on Last\.fm<\/a>\.?/i, '').trim();
            if (cleanBio && !cleanBio.startsWith('<a')) bio = cleanBio;
          }
          if (lfmData.artist.stats) {
            playcount = parseInt(lfmData.artist.stats.playcount || '0', 10);
            monthlyListeners = parseInt(lfmData.artist.stats.listeners || '0', 10);
          }
        }
      }
    } catch (err) { console.error('[Artist] Error Last.fm info:', err); }
  }

  // ── Process Wikipedia (only if no bio yet) ──
  if (!bio && wikiResult.status === 'fulfilled') {
    try {
      const res = wikiResult.value as Response;
      if (res.ok) {
        const wikiData = (await res.json()) as any;
        if (wikiData.extract) bio = wikiData.extract;
        if (!image && wikiData.thumbnail?.source) image = wikiData.thumbnail.source;
      }
    } catch (err) { console.error('[Artist] Error Wikipedia:', err); }
  }

  // ── Process top tracks ──
  const topTracks = topTracksResult.status === 'fulfilled' ? topTracksResult.value : [];

  // ── Process Deezer image + listeners ──
  if (dzResult.status === 'fulfilled') {
    try {
      const res = dzResult.value as Response;
      if (res.ok) {
        const dzData = (await res.json()) as any;
        if (dzData.data?.length > 0) {
          const exactMatch = dzData.data.find((a: any) => a.name.toLowerCase() === name.toLowerCase()) || dzData.data[0];
          image = exactMatch.picture_xl || exactMatch.picture_large || exactMatch.picture || image;
          if (exactMatch.nb_fan > 0) monthlyListeners = Math.round(exactMatch.nb_fan * 8);
        }
      }
    } catch (err) { console.error('[Artist] Error Deezer:', err); }
  }

  // ── Process TheAudioDB ──
  if (adbResult.status === 'fulfilled') {
    try {
      const res = adbResult.value as Response;
      if (res.ok) {
        const adbData = (await res.json()) as any;
        if (adbData.artists?.length > 0) {
          const a = adbData.artists[0];
          fanart = a.strArtistFanart || a.strArtistWideThumb || '';
          gallery = [a.strArtistFanart, a.strArtistFanart2, a.strArtistFanart3, a.strArtistFanart4, a.strArtistThumb, a.strArtistClearart]
            .filter((img: any) => typeof img === 'string' && img.trim() !== '');
          socialLinks = {
            twitter: a.strTwitter ? (a.strTwitter.startsWith('http') ? a.strTwitter : `https://${a.strTwitter}`) : `https://twitter.com/search?q=${encodedName}`,
            facebook: a.strFacebook ? (a.strFacebook.startsWith('http') ? a.strFacebook : `https://${a.strFacebook}`) : undefined,
            website: a.strWebsite ? (a.strWebsite.startsWith('http') ? a.strWebsite : `https://${a.strWebsite}`) : undefined,
            youtube: `https://www.youtube.com/results?search_query=${encodedName}`,
            instagram: `https://www.instagram.com/explore/tags/${encodeURIComponent(name.replace(/\s+/g, ''))}/`,
            spotify: `https://open.spotify.com/search/${encodedName}/artists`,
          };
        }
      }
    } catch (err) { console.error('[Artist] Error AudioDB:', err); }
  }

  // ── Process MusicBrainz (needs 2nd chained request for URL rels) ──
  if (mbResult.status === 'fulfilled') {
    try {
      const res = mbResult.value as Response;
      if (res.ok) {
        const mbSearch = (await res.json()) as any;
        const mbid = mbSearch.artists?.[0]?.id;
        if (mbid) {
          const mbRelRes = await fetch(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels&fmt=json`, { headers: { 'User-Agent': MB_UA } });
          if (mbRelRes.ok) {
            const mbRel = (await mbRelRes.json()) as any;
            const rels: any[] = mbRel.relations || [];
            const officialSite = rels.find((r: any) => r.type === 'official homepage')?.url?.resource;
            const merchandisingLink = rels.find((r: any) => r.type === 'merchandise')?.url?.resource
              || rels.find((r: any) => r.type === 'online store')?.url?.resource;
            const bandcampLink = rels.find((r: any) => r.type === 'bandcamp')?.url?.resource;
            if (merchandisingLink || officialSite) {
              merch = [{ name: `${name} Official Store`, url: merchandisingLink || officialSite, image: image || undefined }];
            }
            if (bandcampLink) merch.push({ name: `${name} en Bandcamp`, url: bandcampLink });
            const insta = rels.find((r: any) => r.type === 'instagram')?.url?.resource;
            const twitter = rels.find((r: any) => r.type === 'twitter')?.url?.resource;
            const youtube = rels.find((r: any) => r.type === 'youtube')?.url?.resource;
            if (insta) socialLinks.instagram = insta;
            if (twitter) socialLinks.twitter = twitter;
            if (youtube) socialLinks.youtube = youtube;
          }
        }
      }
    } catch (err) { console.error('[Artist] Error MusicBrainz:', err); }
  }

  // ── Process Ticketmaster events ──
  if (tmResult.status === 'fulfilled' && tmResult.value) {
    try {
      const res = tmResult.value as Response;
      if (res.ok) {
        const BAD_KEYWORDS_RE = /tribute|homenaje|karaoke|open mic|jam session|virtual|online|cover night|streaming/i;
        const tmData = (await res.json()) as any;
        events = (tmData._embedded?.events || [])
          .filter((ev: any) => {
            if (BAD_KEYWORDS_RE.test(ev.name || '')) return false;
            const seg = ev.classifications?.[0]?.segment?.name;
            return !seg || seg === 'Music';
          })
          .map((ev: any) => ({
            name: ev.name || '',
            date: ev.dates?.start?.localDate || '',
            time: ev.dates?.start?.localTime || '',
            city: ev._embedded?.venues?.[0]?.city?.name || '',
            venue: ev._embedded?.venues?.[0]?.name || '',
            country: ev._embedded?.venues?.[0]?.country?.name || '',
            url: ev.url || undefined,
            soldOut: ev.dates?.status?.code === 'offsale' || ev.dates?.status?.code === 'cancelled',
            status: ev.dates?.status?.code || 'onsale',
            image: ev.images?.find((img: any) => img.ratio === '16_9' && img.width > 500)?.url || ev.images?.[0]?.url || '',
          }));
      }
    } catch (err) { console.error('[Artist] Error Ticketmaster:', err); }
  }

  // ── Process albums ──
  let albums: any[] = [];
  if (albumsResult.status === 'fulfilled') {
    try {
      const res = albumsResult.value as Response;
      if (res.ok) {
        const albumsData = (await res.json()) as any;
        albums = (albumsData.results || [])
          .filter((r: any) => r.wrapperType === 'collection')
          .map((a: any) => ({
            id: String(a.collectionId),
            title: a.collectionName,
            cover: a.artworkUrl100?.replace(/\d+x\d+bb\.jpg$/, '400x400bb.jpg'),
            releaseDate: a.releaseDate,
            trackCount: a.trackCount,
            type: a.trackCount > 3 ? 'Álbum' : 'Single/EP',
          }))
          .sort((a: any, b: any) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime());
      }
    } catch (err) { console.error('[Artist] Error obteniendo álbumes:', err); }
  }

  // ── Process YouTube videos ──
  let musicVideos: any[] = [];
  let livePerformances: any[] = [];
  if (ytResult.status === 'fulfilled') {
    const [mvVideos, liveVideos] = ytResult.value as [any[], any[]];
    musicVideos = mvVideos.map((v: any) => ({
      id: v.videoId, title: v.title, thumbnail: v.thumbnail, views: v.views,
      duration: v.duration?.seconds ? `${Math.floor(v.duration.seconds / 60)}:${String(v.duration.seconds % 60).padStart(2, '0')}` : '',
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));
    livePerformances = liveVideos.map((v: any) => ({
      id: v.videoId, title: v.title, thumbnail: v.thumbnail, views: v.views,
      duration: v.duration?.seconds ? `${Math.floor(v.duration.seconds / 60)}:${String(v.duration.seconds % 60).padStart(2, '0')}` : '',
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));
  }

  if (!image && topTracks.length > 0) image = topTracks[0].cover;



  // Obtener artistas similares de Last.fm + Imágenes de Deezer
  let similarArtists: any[] = [];
  if (process.env.LASTFM_KEY) {
    try {
      const simRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(name)}&api_key=${process.env.LASTFM_KEY}&format=json&limit=10`);
      if (simRes.ok) {
        const simData = (await simRes.json()) as any;
        const lfmArtists = simData.similarartists?.artist || [];
        
        similarArtists = await Promise.all(
          lfmArtists.map(async (a: any) => {
            let simImage = a.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || '';
            // Enrich with Deezer image
            try {
              const dzRes = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(a.name)}&limit=1`);
              if (dzRes.ok) {
                const dzData = (await dzRes.json()) as any;
                if (dzData.data && dzData.data.length > 0) {
                  simImage = dzData.data[0].picture_xl || dzData.data[0].picture_medium || simImage;
                }
              }
            } catch (e) {
              // ignore
            }
            return {
              name: a.name,
              url: a.url,
              image: simImage
            };
          })
        );
      }
    } catch (e) {
      console.error('[Artist] Error obteniendo similares:', e);
    }
  }

  const artistInfo: ArtistInfo = {
    itunesArtistId: artistId,
    name,
    bio: bio || 'Biografía no disponible.',
    image,
    genre,
    topTracks,
    albums,
    musicVideos,
    livePerformances,
    monthlyListeners,
    playcount,
    fanart,
    gallery,
    socialLinks,
    isVerified: monthlyListeners ? monthlyListeners > 100000 : false,
    events,
    merch,
    similarArtists,
  };

  // Persistir en L1
  cache.setex(cacheKey, 3600, JSON.stringify(artistInfo));

  // Persistir en Supabase L2 (async)
  const artistRow: ArtistRow = {
    itunes_artist_id: artistId,
    name,
    genre: genre || null,
    bio: bio || null,
    image_url: image || null,
    updated_at: new Date().toISOString(),
  };
  upsertArtist(artistRow).catch(() => {});

  return artistInfo;
}
