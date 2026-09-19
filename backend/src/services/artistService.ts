/**
 * Artist Service — refactorizado con iTunes Search API
 *
 * Estrategia de caché:
 *   Metadata artista: L1 (1h) → L2 Supabase (30 días) → iTunes + Wikipedia
 *   Top tracks:       se obtienen de metadataService.getArtistTopTracks
 */

import { cache } from './cacheService';
import { getArtistTracksAndCollabs, getArtistTopTracks } from './metadataService';
import { getArtistFromDB, upsertArtist, type ArtistRow } from './supabaseService';

export interface ArtistInfo {
  itunesArtistId: number;
  name: string;
  bio: string;
  image: string;
  genre: string;
  topTracks: any[];
  collaborations?: any[];
  collaborators?: { name: string; count: number }[];
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
  otherArtistsWithName?: { id: number; name: string; genre: string }[];
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

const MUSIC_KEYWORDS = [
  'cantante', 'rapero', 'músico', 'álbum', 'canción', 'banda', 'grupo',
  'productor', 'discográfica', 'género', 'sencillo', 'música', 'hip-hop',
  'pop', 'rock', 'compositor', 'trapero', 'discografía', 'singer', 'rapper',
  'musician', 'chanteur', 'rappeur', 'musique'
];

async function fetchMusicianWikipedia(name: string): Promise<{ bio: string; image?: string } | null> {
  const encodedName = encodeURIComponent(name);

  // 1. Resumen directo en es.wikipedia.org
  try {
    const directRes = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodedName}`);
    if (directRes.ok) {
      const data = (await directRes.json()) as any;
      const combined = `${data.extract || ''} ${data.description || ''}`.toLowerCase();
      // Solo aceptamos si el contenido es explícitamente musical (evita artículos homónimos como el solsticio Yule)
      if (MUSIC_KEYWORDS.some(w => combined.includes(w))) {
        return {
          bio: data.extract,
          image: data.thumbnail?.source || data.originalimage?.source,
        };
      }
    }
  } catch {}

  // 2. Búsqueda específica de músicos en Wikipedia (verificando que el título coincida con el artista)
  const searchQueries = [
    `${name} cantante OR rapero OR músico`,
    `${name} (cantante)`,
    `${name} (rapero)`,
  ];

  const cleanTarget = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  for (const sq of searchQueries) {
    try {
      const searchRes = await fetch(
        `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(sq)}&format=json`
      );
      if (searchRes.ok) {
        const sData = (await searchRes.json()) as any;
        const results = sData.query?.search || [];
        for (const r of results.slice(0, 3)) {
          if (!r.title) continue;

          // VERIFICACIÓN ESTRICTA: El título de Wikipedia DEBE coincidir con el nombre del artista buscado
          // Evita que para "RnBoi" se use "Killer Mike" u otros artículos que solo mencionan palabras musicales
          const cleanTitle = r.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const isTitleMatch = cleanTitle === cleanTarget ||
                               cleanTitle.startsWith(cleanTarget + ' ') ||
                               cleanTitle.startsWith(cleanTarget + '(') ||
                               cleanTitle.includes('(' + cleanTarget + ')');
          if (!isTitleMatch) continue;

          const pageRes = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.title)}`);
          if (pageRes.ok) {
            const pData = (await pageRes.json()) as any;
            const combined = `${pData.extract || ''} ${pData.description || ''}`.toLowerCase();
            if (MUSIC_KEYWORDS.some(w => combined.includes(w))) {
              return {
                bio: pData.extract,
                image: pData.thumbnail?.source || pData.originalimage?.source,
              };
            }
          }
        }
      }
    } catch {}
  }

  // 3. Fallback a Wikipedia francesa / inglesa si es un artista internacional
  for (const lang of ['fr', 'en']) {
    try {
      const langRes = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedName}_(rappeur)`);
      if (langRes.ok) {
        const data = (await langRes.json()) as any;
        if (data.extract) {
          return {
            bio: data.extract,
            image: data.thumbnail?.source || data.originalimage?.source,
          };
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Obtiene info de un artista por su iTunes Artist ID o nombre.
 * Imagen: Deezer HD / Wikipedia / Artwork del álbum más reciente.
 * Bio: Wikipedia verificado musicalmente o Last.fm.
 * Si iTunes no encuentra el artista → fallback a canal de YouTube.
 */
export async function getArtistInfo(artistIdentifier: number | string): Promise<ArtistInfo | null> {
  let artistId = typeof artistIdentifier === 'number' ? artistIdentifier : 0;
  let searchName = typeof artistIdentifier === 'string' ? artistIdentifier : '';

  if (!artistId && searchName) {
    try {
      const cleanSearch = searchName.trim().toLowerCase();
      const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(searchName)}&entity=musicArtist&limit=5`);
      if (searchRes.ok) {
        const data = (await searchRes.json()) as any;
        const artists = (data.results || []).filter((r: any) => r.wrapperType === 'artist' && r.artistId);
        // Buscar primero coincidencia exacta de nombre
        const exact = artists.find((a: any) => (a.artistName || '').trim().toLowerCase() === cleanSearch);
        const chosen = exact || artists[0];
        if (chosen && chosen.artistId) {
          artistId = chosen.artistId;
        }
      }
    } catch (e) {
      console.error('[Artist] Error buscando artista por nombre:', e);
    }
  }

  // Si no pudimos resolver un ID numérico desde iTunes, intentar KokoMusic-lite lookup o canal de YouTube
  if (!artistId && searchName) {
    // 1. Intentar lookup de KokoMusic-lite (YouTube Music Artist Profile)
    try {
      const { lookupArtist } = await import('./kokoLiteClient');
      const liteProfile = await lookupArtist(searchName);
      if (liteProfile && (liteProfile.name || liteProfile.id)) {
        const customId = hashStringToInteger(liteProfile.name || searchName);
        const info: ArtistInfo = {
          itunesArtistId: customId,
          name: liteProfile.name || searchName,
          bio: liteProfile.description || `Artista verificado en YouTube Music.`,
          image: liteProfile.thumbnail || liteProfile.photo || '',
          genre: 'Urbano / Pop',
          topTracks: (liteProfile.topSongs || []).map((s: any, idx: number) => ({
            id: s.id,
            itunesId: 0,
            artistId: customId,
            title: s.title,
            artist: liteProfile.name || searchName,
            album: s.album || 'YouTube',
            cover: s.thumbnail || liteProfile.thumbnail || '',
            duration: (s.durationSeconds || 180) * 1000,
            genre: '',
            releaseDate: null,
            popularity: 1000 - idx,
            preview_url: null,
          })),
          albums: liteProfile.albums || [],
          similarArtists: (liteProfile.relatedArtists || []).map((r: any) => ({
            name: r.name,
            image: r.thumbnail,
            url: `/artist/${encodeURIComponent(r.name)}`,
          })),
          monthlyListeners: 0,
          playcount: 0,
        };
        cache.setex(`artist:${customId}`, 3600 * 6, JSON.stringify(info));
        cache.setex(`artist:${encodeURIComponent(searchName)}`, 3600 * 6, JSON.stringify(info));
        return info;
      }
    } catch (err) {
      console.warn('[Artist] KokoMusic-lite lookup falló:', err);
    }

    // 2. Fallback a canal de YouTube
    console.log(`[Artist] iTunes sin resultados para "${searchName}" → buscando canal de YouTube`);
    const ytCacheKey = `artist-yt:${searchName.toLowerCase().replace(/\s+/g, '-')}`;
    const ytCached = cache.get(ytCacheKey);
    if (ytCached) return JSON.parse(ytCached);
    const ytInfo = await buildArtistInfoFromYouTube(searchName);
    if (ytInfo) {
      cache.setex(ytCacheKey, 3600 * 6, JSON.stringify(ytInfo)); // 6h cache
      return ytInfo;
    }
    return null;
  }

  const cacheKey = `artist-v3:${artistId}`;

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
    homonymsResult,
  ] = await Promise.allSettled([
    // LastFM bio + stats
    process.env.LASTFM_KEY
      ? fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodedName}&api_key=${process.env.LASTFM_KEY}&lang=es&format=json`)
      : Promise.resolve(null),
    // Wikipedia verificado musicalmente (evita colisiones como Yule en Jul)
    fetchMusicianWikipedia(name),
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
    // iTunes top tracks + colaboraciones + colaboradores frecuentes
    getArtistTracksAndCollabs(artistId, 25),
    // iTunes albums
    fetch(`https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200`),
    // YouTube videos (MV + live)
    import('./ytdlpSearchService').then(async ({ searchYtdlp }) => {
      return Promise.all([
        searchYtdlp(`${name} official music video`, 6),
        searchYtdlp(`${name} live performance`, 4),
      ]);
    }),
    // Homónimos en iTunes (otros artistas con el mismo nombre para mostrar perfiles separados)
    fetch(`https://itunes.apple.com/search?term=${encodedName}&entity=musicArtist&limit=8`),
  ]);

  // ── Process LastFM ──
  if (lfmResult.status === 'fulfilled' && lfmResult.value) {
    try {
      const res = lfmResult.value as Response;
      if (res && res.ok) {
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

  // ── Process Wikipedia musical verificado ──
  if (wikiResult.status === 'fulfilled' && wikiResult.value) {
    const wikiData = wikiResult.value;
    if (!bio && wikiData.bio) bio = wikiData.bio;
    if (wikiData.image && (!image || image.includes('mzstatic.com'))) {
      image = wikiData.image;
    }
  }

  // ── Process top tracks & collaborations ──
  const artistTracksData = topTracksResult.status === 'fulfilled'
    ? topTracksResult.value
    : { topTracks: [], collaborations: [], collaborators: [] };
  const topTracks = artistTracksData.topTracks || [];
  const collaborations = artistTracksData.collaborations || [];
  const rawCollaborators = artistTracksData.collaborators || [];

  // Enriquecer los colaboradores frecuentes con su foto de perfil real (Deezer / iTunes)
  const collaborators = await Promise.all(
    rawCollaborators.slice(0, 15).map(async (c: any) => {
      let image = c.image || '';
      try {
        const dzRes = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(c.name)}&limit=1`);
        if (dzRes.ok) {
          const dzData = (await dzRes.json()) as any;
          const match = dzData.data?.[0];
          if (match?.picture_medium || match?.picture_small || match?.picture) {
            image = match.picture_medium || match.picture_small || match.picture;
          }
        }
      } catch {}

      if (!image) {
        try {
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(c.name)}&entity=song&limit=1`);
          if (itunesRes.ok) {
            const itunesData = (await itunesRes.json()) as any;
            const track = itunesData.results?.[0];
            if (track?.artworkUrl100) {
              image = track.artworkUrl100.replace(/\d+x\d+bb\.jpg$/, '300x300bb.jpg');
            }
          }
        } catch {}
      }

      return { ...c, image };
    })
  );

  // ── Process Deezer image + listeners (con ordenamiento por fans para evitar homónimos menores) ──
  if (dzResult.status === 'fulfilled') {
    try {
      const res = dzResult.value as Response;
      if (res.ok) {
        const dzData = (await res.json()) as any;
        if (dzData.data?.length > 0) {
          const cleanName = name.toLowerCase().trim();
          // Filtrar los artistas que coincidan exactamente con el nombre
          const matching = dzData.data.filter((a: any) => (a.name || '').toLowerCase().trim() === cleanName);
          // IMPORTANTE: Ordenar por número de fans descendente para evitar homónimos con fotos ajenas (ej. 128 fans vs 11 millones)
          const sorted = matching.sort((a: any, b: any) => (b.nb_fan || 0) - (a.nb_fan || 0));
          const exactMatch = sorted[0] || dzData.data[0];

          if (exactMatch) {
            const dzPic = exactMatch.picture_xl || exactMatch.picture_large || exactMatch.picture;
            if (dzPic && !dzPic.includes('placeholder') && !dzPic.includes('default')) {
              image = dzPic;
            }
            if (exactMatch.nb_fan > 0) {
              monthlyListeners = Math.round(exactMatch.nb_fan * 1.5);
            }
          }
        }
      }
    } catch (err) { console.error('[Artist] Error Deezer:', err); }
  }

  // ── Process TheAudioDB (filtrando logos o placeholders genéricos como "db") ──
  if (adbResult.status === 'fulfilled') {
    try {
      const res = adbResult.value as Response;
      if (res.ok) {
        const adbData = (await res.json()) as any;
        if (adbData.artists?.length > 0) {
          const a = adbData.artists[0];
          const isBadAdbImage = (url: string) => {
            if (!url || typeof url !== 'string') return true;
            const lower = url.toLowerCase();
            return lower.includes('placeholder') || lower.includes('default') || lower.includes('logo') || lower.includes('banner_empty');
          };

          if (a.strArtistFanart && !isBadAdbImage(a.strArtistFanart)) {
            fanart = a.strArtistFanart;
          }
          gallery = [a.strArtistFanart, a.strArtistFanart2, a.strArtistFanart3, a.strArtistFanart4, a.strArtistThumb, a.strArtistClearart]
            .filter((img: any) => typeof img === 'string' && img.trim() !== '' && !isBadAdbImage(img));

          if (!bio) {
            bio = a.strBiographyES || a.strBiographyFR || a.strBiography || '';
          }

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

  // ── Process albums (con filtro de coherencia de alfabeto/script) ──
  let albums: any[] = [];
  if (albumsResult.status === 'fulfilled') {
    try {
      const res = albumsResult.value as Response;
      if (res.ok) {
        const albumsData = (await res.json()) as any;
        const rawCollections = (albumsData.results || []).filter((r: any) => r.wrapperType === 'collection');

        // Detección de coherencia de alfabeto/script para evitar colisiones de nombres (ej. "Неслухняна - Single" de Jul)
        const nonLatinRegex = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/;
        let latinCount = 0;
        for (const c of rawCollections) {
          if (!nonLatinRegex.test(c.collectionName || '')) latinCount++;
        }
        const isDominantlyLatin = (latinCount / (rawCollections.length || 1)) >= 0.80;

        const cleanTargetName = name.toLowerCase().trim();
        albums = rawCollections
          .filter((a: any) => {
            // Filtrar álbumes donde el artista NO es el artista principal (ej. colaboraciones como invitado en álbumes de otros artistas)
            const collArtist = (a.artistName || '').toLowerCase().trim();
            if (cleanTargetName && !collArtist.startsWith(cleanTargetName)) {
              return false;
            }

            const title = a.collectionName || '';
            // Si el 80%+ de los álbumes del artista son alfabeto latino, filtrar álbumes en alfabetos incompatibles (cirílico, etc.)
            if (isDominantlyLatin && nonLatinRegex.test(title)) {
              console.log(`[Artist] Filtrado álbum con alfabeto no coincidente: "${title}" para ${name}`);
              return false;
            }
            return true;
          })
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

  // ── Process homónimos (otros artistas con el mismo nombre y géneros distintos) ──
  let otherArtistsWithName: { id: number; name: string; genre: string }[] = [];
  if (homonymsResult.status === 'fulfilled') {
    try {
      const res = homonymsResult.value as Response;
      if (res && res.ok) {
        const hData = (await res.json()) as any;
        const cleanTarget = name.toLowerCase().trim();
        const currentGenreClean = (genre || '').toLowerCase().trim();
        const sameName = (hData.results || []).filter((a: any) => {
          if (a.wrapperType !== 'artist') return false;
          if (a.artistId === artistId) return false;
          const aName = (a.artistName || '').toLowerCase().trim();
          if (aName !== cleanTarget) return false;
          // Solo considerar como homónimo real si tiene un género explícito y diferente al género actual (evita perfiles duplicados del mismo artista)
          const aGenre = (a.primaryGenreName || '').toLowerCase().trim();
          if (!aGenre || aGenre === 'música' || aGenre === currentGenreClean) {
            return false;
          }
          return true;
        });
        otherArtistsWithName = sameName.map((h: any) => ({
          id: h.artistId,
          name: h.artistName,
          genre: h.primaryGenreName || 'Música',
        }));
      }
    } catch {}
  }

  // Si tras consultar todas las fuentes no hay biografía externa verificada, generar una biografía auténtica
  if (!bio || bio === 'Biografía no disponible.' || bio.trim() === '') {
    const genreDesc = genre ? `${genre}` : 'música urbana y contemporánea';
    const listenersDesc = monthlyListeners && monthlyListeners > 0
      ? ` con más de ${monthlyListeners.toLocaleString('es-ES')} oyentes en plataformas digitales`
      : '';
    bio = `${name} es un artista de ${genreDesc}${listenersDesc}. Explora su discografía oficial, sencillos y actuaciones a continuación.`;
  }

  const artistInfo: ArtistInfo = {
    itunesArtistId: artistId,
    name,
    bio,
    image,
    genre,
    topTracks,
    collaborations,
    collaborators,
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
    otherArtistsWithName,
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
