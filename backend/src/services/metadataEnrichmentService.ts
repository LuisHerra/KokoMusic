/**
 * metadataEnrichmentService.ts — Background Track Metadata Enrichment
 *
 * Fills the gap between what is stored in user_history.json (only title, artist, cover)
 * and what the recommendation engine needs (genre, tags, language, duration, listeners).
 *
 * Strategy per track type:
 *   iTunes tracks (numeric ID, e.g. "1865959223"):
 *     1. getTrackById(id)          → genre, album, duration, releaseDate (free, fast, already cached)
 *     2. Last.fm track.getInfo     → folksonomy tags ["reggaeton","trap","urbano"] (if LASTFM_KEY set)
 *     3. Last.fm artist.getTopTags → artist-level fallback tags
 *
 *   YouTube tracks (alphanumeric ID, e.g. "mYyIKtgGL20"):
 *     1. iTunes search(artist+title, 1) → genre from iTunesSearchAPI
 *     2. Last.fm artist.getTopTags      → folksonomy tags
 *
 * Output stored in: data/enriched_metadata.json (keyed by trackId)
 * Cache TTL: 30 days per track (tags don't change frequently)
 */

import fs from 'fs';
import path from 'path';
import { readHistory } from './historyService';
import { getTrackById, searchTracks } from './metadataService';
import { cache } from './cacheService';

// ── Config ────────────────────────────────────────────────────────────────────

const ENRICHED_FILE = path.join(__dirname, '../../data/enriched_metadata.json');
const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';
const ENRICHMENT_TTL_DAYS = 30;

// Requests per second budget — stay under Last.fm's ~5 req/s limit
const LFM_DELAY_MS = 220; // ~4.5 req/s

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichedTrackMeta {
  trackId: string;
  title: string;
  artist: string;
  /** iTunes primaryGenreName or Last.fm-inferred genre */
  genre: string;
  /** Last.fm folksonomy tags — the heart of the enrichment */
  tags: string[];
  /** Language/culture classification from tags */
  language: TrackCulture;
  /** Last.fm listener count (log-scaled for popularity scoring) */
  listeners?: number;
  /** Track duration in ms (from iTunes) */
  duration?: number;
  /** Album name (from iTunes) */
  album?: string;
  /** Release date ISO string (from iTunes) */
  releaseDate?: string;
  /** ISO timestamp of enrichment */
  enrichedAt: string;
  /** Data source combination */
  source: 'itunes+lastfm' | 'itunes_only' | 'lastfm_only' | 'search_only';
}

// ── Storage ───────────────────────────────────────────────────────────────────

function ensureDir(): void {
  const dir = path.dirname(ENRICHED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readEnrichmentCache(): Record<string, EnrichedTrackMeta> {
  ensureDir();
  if (!fs.existsSync(ENRICHED_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ENRICHED_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeEnrichmentCache(cache: Record<string, EnrichedTrackMeta>): void {
  ensureDir();
  fs.writeFileSync(ENRICHED_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

/** In-memory read-through for fast lookups during recommendation requests */
let memCache: Record<string, EnrichedTrackMeta> | null = null;

function getMemCache(): Record<string, EnrichedTrackMeta> {
  if (!memCache) {
    memCache = readEnrichmentCache();
  }
  return memCache;
}

function setInMemCache(trackId: string, meta: EnrichedTrackMeta): void {
  if (!memCache) memCache = readEnrichmentCache();
  memCache[trackId] = meta;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the trackId looks like an iTunes numeric ID */
function isItunesId(trackId: string): boolean {
  return /^\d{6,12}$/.test(trackId.trim());
}

/** Whether the enriched entry is still fresh (within TTL) */
function isStale(meta: EnrichedTrackMeta): boolean {
  if (!meta.enrichedAt) return true;
  const ageDays = (Date.now() - new Date(meta.enrichedAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > ENRICHMENT_TTL_DAYS;
}

/** Sleep helper for rate limiting */
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Last.fm fetchers ──────────────────────────────────────────────────────────

/** Fetch per-track Last.fm tags (most precise genre signal available) */
async function fetchTrackTags(artist: string, title: string): Promise<{ tags: string[]; listeners?: number }> {
  if (!LFM_KEY) return { tags: [] };

  const cacheKey = `lfm:tracktags:${artist.toLowerCase()}:${title.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  try {
    const url = `${LFM_BASE}?method=track.getinfo&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${LFM_KEY}&format=json&autocorrect=1`;
    const res = await fetch(url);
    if (!res.ok) return { tags: [] };
    const data = await res.json() as any;

    const rawTags: string[] = (data?.track?.toptags?.tag || [])
      .slice(0, 6)
      .map((t: any) => (typeof t === 'string' ? t : t.name) as string)
      .filter(Boolean);
    const listeners = data?.track?.listeners ? parseInt(data.track.listeners, 10) : undefined;

    const result = { tags: rawTags, listeners };
    if (rawTags.length > 0) {
      // Cache for 7 days — tags are stable
      cache.setex(cacheKey, 7 * 24 * 3600, JSON.stringify(result));
    }
    return result;
  } catch {
    return { tags: [] };
  }
}

/** Fetch artist-level Last.fm tags (fallback when track tags are empty) */
async function fetchArtistTagsCached(artist: string): Promise<string[]> {
  if (!LFM_KEY) return [];

  const cacheKey = `lfm:artisttags:${artist.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch {}
  }

  try {
    const url = `${LFM_BASE}?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&api_key=${LFM_KEY}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const tags: string[] = (data?.toptags?.tag || [])
      .slice(0, 6)
      .map((t: any) => (typeof t === 'string' ? t : t.name) as string)
      .filter(Boolean);

    if (tags.length > 0) {
      cache.setex(cacheKey, 7 * 24 * 3600, JSON.stringify(tags));
    }
    return tags;
  } catch {
    return [];
  }
}

export type TrackCulture = 'french' | 'latin' | 'mexican' | 'english' | 'phonk' | 'italian' | 'german' | 'kpop' | 'japanese' | 'other';

/**
 * Comprehensive Language/Culture Detector for Tracks.
 * Evaluates Last.fm tags, iTunes genre, track title, and artist name.
 *
 * Classifies tracks into:
 *  - 'mexican': Música Mexicana, Corridos Tumbados, Regional Mexicano, Banda, Ranchera
 *  - 'latin': Reggaetón, Urbano, Latin Pop, Spanish Rock, Flamenco, Bachata
 *  - 'french': Rap Français, Chanson, French Pop, Afro-Trap FR
 *  - 'phonk': Brazilian Phonk, Funk Carioca, Funk Paulista, Montagem, Drift Phonk, Portuguese tracks
 *  - 'italian': Rap Italiano, Trap Italia, Sanremo, Pop Italiano
 *  - 'german': Deutschrap, German Pop, Schlager
 *  - 'kpop': K-Pop, K-Hip Hop, K-R&B
 *  - 'japanese': J-Pop, J-Rock, Anime OST
 *  - 'english': US/UK Pop, Hip-Hop, Rock, R&B, EDM, Country
 *  - 'other': Unclassified / Instrumental / Other languages
 */
export function detectTrackCulture(
  artist = '',
  title = '',
  genre = '',
  tags: string[] = []
): TrackCulture {
  const normArtist = (artist || '').toLowerCase().trim();
  const normTitle = (title || '').toLowerCase().trim();
  const normGenre = (genre || '').toLowerCase().trim();
  const normTags = (tags || []).map(t => t.toLowerCase().trim());
  const joined = `${normTags.join(' ')} ${normGenre} ${normArtist} ${normTitle}`;

  // ── 0a. MEXICAN SIGNALS (Música Mexicana, Corridos Tumbados, Banda, Ranchera) ────
  const isMexicanArtist = /\b(peso pluma|gabito ballesteros|junior h|natanael cano|fuerza regida|grupo frontera|tito double p|luis r conriquez|chino pacas|carin leon|carín león|oscar maydon|xavi|eden muñoz|grupo firme|christian nodal|banda ms|julion alvarez|julián álvarez|calibre 50|los tucanes de tijuana|chalino sanchez|ariel camacho)\b/i.test(normArtist);

  const isMexicanTagOrGenre = /\b(mexico|méxico|regional mexicano|corridos|corridos tumbados|corridos belicos|corridos bélicos|musica mexicana|música mexicana|banda|norteño|norteno|ranchera|sierreño|sierreno|mariachi|hitos mexicanos)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  const isMexicanTitleWords = /\b(corrido|tumbado|bélico|belico|bélicos|belicos|clika|belicona|pacas|cuerno|banda|norteño|ranchera|mexico|méxico|jalisco|sinaloa|tijuana|zapopan)\b/i.test(normTitle);

  if (isMexicanArtist || isMexicanTagOrGenre || isMexicanTitleWords) {
    return 'mexican';
  }

  // ── 0a. ITALIAN SIGNALS ─────────────────────────────────────────────────────
  const isItalianArtist = /\b(samurai jay|sfera ebbasta|salento guys|santiago|romano|rondodasosa|lazza|capo plaza|geolier|tedua|ernia|marracash|gue|guè|ghali|shiva|tony effe|anna|kid yugi|paky|rose villain|blanco|mahmood|salmo|fedez|luchè|sangiovanni|rkomi|irama|coez|måneskin|maneskin|elodie|tiziano ferro|lorenzo jovanotti|thasup|drefgold|ava|takagi & ketra)\b/i.test(normArtist);

  const isItalianTagOrGenre = /\b(italy|italian|italiano|trap italia|rap italiano|hip hop italiano|italo|italo disco|italo dance|sanremo|pop italiano|musica italiana|napoli|neapolitan)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  const isItalianTitleWords = /\b(che|con|se|non|della|dello|nella|delle|degli|solo|tutto|tutti|tutta|vita|notte|amore|storia|senza|come|dove|quando|ancora|sempre|bella|bello|strada|parole|mondo|cuore|vivere|quello|quella|questo|questa)\b/i.test(normTitle);

  if (isItalianArtist || isItalianTagOrGenre || (isItalianTitleWords && (normGenre.includes('hip-hop') || normGenre.includes('rap') || normGenre.includes('pop') || normGenre.includes('urban') || normGenre === ''))) {
    return 'italian';
  }

  // ── 0b. GERMAN SIGNALS ──────────────────────────────────────────────────────
  const isGermanArtist = /\b(capital bra|raf camora|bonez mc|apache 207|kontra k|luciano|shindy|kurdo|sido|ufo361|nimo|cro|rammstein|nina chuba|ski aggu|shirin david|pashanim)\b/i.test(normArtist);

  const isGermanTagOrGenre = /\b(deutschrap|german|deutsch|german hip hop|german pop|schlager|german rap)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  const isGermanTitleWords = /\b(und|ich|du|der|die|das|mit|nicht|auf|ist|ein|eine|wir|von|nach|über)\b/i.test(normTitle);

  if (isGermanArtist || isGermanTagOrGenre || isGermanTitleWords) {
    return 'german';
  }

  // ── 0c. KPOP SIGNALS ────────────────────────────────────────────────────────
  const isKpopArtist = /\b(bts|blackpink|stray kids|twice|newjeans|seventeen|exo|enhypen|txt|ateez|itzy|le sserafim|aespa|ive|red velvet|nct)\b/i.test(normArtist);

  const isKpopTagOrGenre = /\b(k-pop|kpop|korean|k-hip hop|k-indie|k-r&b)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  if (isKpopArtist || isKpopTagOrGenre) {
    return 'kpop';
  }

  // ── 0d. JAPANESE SIGNALS ────────────────────────────────────────────────────
  const isJapaneseArtist = /\b(yoasobi|kenshi yonezu|lisa|ado|eve|king gnu|fujii kaze|one ok rock|radwimps|aimyon|vaundy|official hige dandism)\b/i.test(normArtist);

  const isJapaneseTagOrGenre = /\b(j-pop|jpop|j-rock|jrock|anime|japanese|vocaloid)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  if (isJapaneseArtist || isJapaneseTagOrGenre) {
    return 'japanese';
  }

  // ── 0e. PHONK & BRAZILIAN FUNK / PORTUGUESE SIGNALS ─────────────────────────
  const isPhonkTagOrGenre = /\b(phonk|brazilian phonk|funk carioca|funk paulista|funk mandelao|mandelao|mandelão|megafunk|automotivo|drift phonk|phonk house|hyperfunk|montagem|funk consciente|electro funk|funk brasil|funk brasileiro|portugal|portuguese|eurovision song contest|indie portugal|pop portugues|musica portuguesa)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  const isPhonkArtist = /\b(napa|kordhell|sxmpra|scz|interworld|g3oxem|haarper|freddie dredd|lxst cxntury|shadowraze|shelby|phonk|slowboy|mc mazinho|dj arana|mc ryan sp|mc daniel|mc harrison|mc ig|mc poze|dj boy|dj renan|dj felipe nunes)\b/i.test(normArtist);

  const isPortugueseTitleWords = /\b(taka|la dentro|dentro|deslocado|montagem|automotivo|mandelao|mandelão|baile|funk|ritmo|velocidade|sequencia|sequência|vulcão|vulcao|tambor|grave|estourado|megafunk|batida|tropa|favela|escuta|solta|troca|vem|vai|desce|sobe|jogando|mexendo|novinha|garota|menina|saudade|fado|lisboa|porto|cancao|canção)\b/i.test(normTitle);

  if (isPhonkTagOrGenre || isPhonkArtist || isPortugueseTitleWords) {
    return 'phonk';
  }

  // ── 1. FRENCH SIGNALS ──────────────────────────────────────────────────────
  const isFrenchArtist = /\b(rnboi|gims|naza|tayc|plk|ninho|tiakola|alonzo|dadju|soolking|mauvais djo|niska|booba|damso|pnl|nekfeu|stromae|aya nakamura|sch|jul|koba lad|zola|danyl|gazo|kerchak|werenoi|sdm|hamza|bosh|heuss|dr\. yaro|dr yaro|keblack|franglish|gradur|rk|soso maness|favé)\b/i.test(normArtist);
  const isFrenchTagOrGenre = /\b(french|francais|français|rap fr\b|rap francais|rap français|chanson|afro trap fr|verlan|banlieue|variete francaise|french pop|french rap)\b/i.test(`${normTags.join(' ')} ${normGenre}`);
  if (isFrenchArtist || isFrenchTagOrGenre) {
    return 'french';
  }

  // ── 2. LATIN / SPANISH SIGNALS ─────────────────────────────────────────────
  const isLatinArtist = /\b(quevedo|feid|bad bunny|myke towers|rauw alejandro|ozuna|j balvin|anuel|karol g|trueno|mora|bizarrap|jhayco|duki|eladio|ryan castro|young miko|saiko|dei v|omar courtz|gonzy|maná|mana|el bobe|rvfv|jcreyes|omay|morad|charlie puth|rosalía|rosalia|aitana|rels b|c\. tangana|c tangana|alejandro sanz|melendi|estopa|omar montes|kidd keo|nathy peluso|enrique iglesias|luis fonsi|daddy yankee|don omar|wisin|yandel|maluma|shakira|julieta venegas|becky g|danna|danna paola|peso pluma|fuerza regida|grupo frontera|natanael cano|junior h|pablo alboran|pablo alborán|camilo|alvaro de luna|nil moliner|lola indigo|lola índigo|ana mena|abraham mateo|vicco|bad gyal|sen senra|recycled j|dano|delaossa|erick hervé|hard gz|kase\.o|kase o|sfdk|nach|toteking|zatu|sharif|ambkor|blake|foyone|israel b|kaydy cain|yung beef|cecilio g|pedro ladroga)\b/i.test(normArtist);

  const isLatinTagOrGenre = /\b(reggaeton|regueton|urbano|latin|spanish|espanol|español|musica latina|música latina|latin pop|latin trap|cumbia|salsa|dembow|bachata|perreo|flamenco|rumba|tango|pop en espanol|pop en español|rock en espanol|rock en español|indie espanol|indie español|hip hop espanol|rap espanol|trap espanol|trap latino|corridos|corridos tumbados|ranchera|mariachi|flamenco pop)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  // Spanish title words check (matches standalone Spanish words in track title)
  const isSpanishTitleWords = /\b(de|la|el|con|por|para|sin|contigo|ti|tu|yo|mi|me|te|se|su|sus|nos|nosotros|amor|corazon|corazón|noche|noches|vida|solo|sola|nada|todo|beso|besos|dime|donde|dónde|siempre|hasta|hacer|quisiera|boca|fuego|ojos|sueno|sueño|llorar|sabes|baila|bailar|musica|música|cancion|canción|luna|sol|cielo|tierra|mundo|loco|loca|quiero|queres|quieres|puedo|podemos|tienes|tengo|tardes|dias|días|hola|adios|adiós|jamas|jamás|volver|verte|darte|perder|ganar|casa|calle|gente|fiesta|viento|mar)\b/i.test(normTitle);

  if (isLatinArtist || isLatinTagOrGenre || (isSpanishTitleWords && (normGenre.includes('pop') || normGenre.includes('latin') || normGenre.includes('hip-hop') || normGenre.includes('urban') || normGenre === ''))) {
    return 'latin';
  }

  // ── 3. ENGLISH SIGNALS ─────────────────────────────────────────────────────
  const isEnglishTagOrGenre = /\b(american|british|uk rap|us rap|country|indie rock|alternative rock|heavy metal|britpop|classic rock|west coast|east coast|english|hip hop|hip-hop|r&b|soul|pop|rock|electronic|edm|house|grime|afrobeats|dancehall)\b/i.test(`${normTags.join(' ')} ${normGenre}`);

  if (isEnglishTagOrGenre) {
    return 'english';
  }

  return 'other';
}

/** Legacy alias for backwards compatibility */
export function detectLanguageFromTags(
  tags: string[] = [],
  genre = '',
  artist = '',
  title = ''
): TrackCulture {
  return detectTrackCulture(artist, title, genre, tags);
}


// ── Core Enrichment ───────────────────────────────────────────────────────────

/**
 * Enriches a single track with genre, tags, language, and duration metadata.
 * Writes the result to the persistent enrichment cache.
 *
 * Does NOT throw — returns null on total failure.
 */
export async function enrichTrack(
  trackId: string,
  artist: string,
  title: string
): Promise<EnrichedTrackMeta | null> {
  try {
    let genre = '';
    let album: string | undefined;
    let duration: number | undefined;
    let releaseDate: string | undefined;
    let tags: string[] = [];
    let listeners: number | undefined;
    let source: EnrichedTrackMeta['source'] = 'search_only';

    // ── Step 1: iTunes metadata (free, fast) ─────────────────────────────────
    if (isItunesId(trackId)) {
      // Numeric ID → direct lookup (Supabase L2 → iTunes)
      try {
        const track = await getTrackById(trackId);
        if (track) {
          genre = track.genre || '';
          album = track.album || undefined;
          duration = track.duration || undefined;
          releaseDate = track.releaseDate || undefined;
          source = 'itunes_only';
        }
      } catch { /* fallthrough to search */ }
    }

    // If iTunes direct lookup failed or it's a YouTube ID, search by name
    if (!genre) {
      try {
        const results = await searchTracks(`${artist} ${title}`, 1, 'itunes');
        const t = results?.[0];
        if (t) {
          genre = t.genre || '';
          album = album || t.album || undefined;
          duration = duration || t.duration || undefined;
          releaseDate = releaseDate || t.releaseDate || undefined;
          source = 'search_only';
        }
      } catch { /* ignore */ }
    }

    // ── Step 2: Last.fm tags (requires LFM_KEY) ──────────────────────────────
    if (LFM_KEY) {
      const trackTagResult = await fetchTrackTags(artist, title);
      tags = trackTagResult.tags;
      listeners = trackTagResult.listeners;

      // Fallback: artist-level tags if track tags are sparse
      if (tags.length < 2) {
        await sleep(LFM_DELAY_MS);
        const artistTags = await fetchArtistTagsCached(artist);
        tags = tags.length > 0 ? tags : artistTags;
      }

      source = genre
        ? 'itunes+lastfm'
        : tags.length > 0 ? 'lastfm_only' : 'search_only';
    }

    const language = detectTrackCulture(artist, title, genre, tags);

    const enriched: EnrichedTrackMeta = {
      trackId,
      title,
      artist,
      genre: genre || 'Unknown',
      tags,
      language,
      listeners,
      duration,
      album,
      releaseDate,
      enrichedAt: new Date().toISOString(),
      source,
    };

    // Persist to cache
    setInMemCache(trackId, enriched);
    const disk = readEnrichmentCache();
    disk[trackId] = enriched;
    writeEnrichmentCache(disk);

    return enriched;
  } catch (err) {
    console.error(`[Enrichment] Failed to enrich ${artist} - ${title}:`, err);
    return null;
  }
}

// ── Batch Enrichment ──────────────────────────────────────────────────────────

/**
 * Enriches the N most-played unenriched tracks from history for a given user.
 * Sorted by playCount descending so the highest-impact tracks are enriched first.
 *
 * Non-blocking: the caller should NOT await this in a request/response cycle.
 *
 * @param userId - if provided, only enrich that user's history
 * @param limit  - max tracks to enrich in this batch (default: 100)
 * @returns a summary object with counts (for logging / admin endpoint)
 */
export async function enrichHistoryBatch(
  userId?: string,
  limit = 100
): Promise<{ processed: number; skipped: number; failed: number }> {
  const existing = getMemCache();
  const history = readHistory().filter(h => {
    if (userId) return h.userId === userId;
    return true; // all users when no userId specified
  });

  // Sort by playCount desc — highest-played tracks have most impact on recommendations
  const sorted = [...history].sort((a, b) => (b.playCount || 0) - (a.playCount || 0));

  const toEnrich = sorted.filter(h => {
    const cached = existing[h.trackId];
    if (!cached) return true;           // never enriched
    if (isStale(cached)) return true;   // TTL expired
    return false;                       // fresh, skip
  }).slice(0, limit);

  console.log(`[Enrichment] Starting batch: ${toEnrich.length} tracks to enrich (limit=${limit}, user=${userId || 'all'})`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of toEnrich) {
    const result = await enrichTrack(entry.trackId, entry.artist, entry.title);
    if (result) {
      processed++;
    } else {
      failed++;
    }

    // Rate limit — stay under Last.fm's 5 req/s (we make up to 2 LFM calls per track)
    if (LFM_KEY) await sleep(LFM_DELAY_MS * 2);
  }

  console.log(`[Enrichment] Batch complete: ${processed} enriched, ${failed} failed, ${skipped} skipped`);
  return { processed, skipped, failed };
}

// ── Public Read API ───────────────────────────────────────────────────────────

/**
 * Fast lookup of enriched metadata for a trackId.
 * Returns null if the track has never been enriched.
 */
export function getEnrichedMeta(trackId: string): EnrichedTrackMeta | null {
  const mem = getMemCache();
  return mem[trackId] || null;
}

/**
 * Returns enriched tags for a track, or an empty array if not enriched yet.
 * Convenience wrapper for use in recommendationService.ts.
 */
export function getTagsForTrack(trackId: string): string[] {
  return getEnrichedMeta(trackId)?.tags || [];
}

/**
 * Returns enriched genre for a track, or null if not enriched.
 */
export function getGenreForTrack(trackId: string): string | null {
  const meta = getEnrichedMeta(trackId);
  return meta?.genre && meta.genre !== 'Unknown' ? meta.genre : null;
}

/**
 * Returns a log-scaled popularity score from Last.fm listener count.
 * Maps listeners → 0-100 range, neutral 50 if unknown.
 * log10(1,000,000 listeners) * 16.6 ≈ 100
 * log10(10,000 listeners) * 16.6 ≈ 66
 * log10(100 listeners) * 16.6 ≈ 33
 */
export function getPopularityScore(trackId: string): number {
  const meta = getEnrichedMeta(trackId);
  if (!meta?.listeners || meta.listeners <= 0) return 50;
  return Math.min(100, Math.max(1, Math.log10(meta.listeners) * 16.6));
}

// ── Auto-startup Enrichment ───────────────────────────────────────────────────

let startupEnrichmentDone = false;

/**
 * Triggers a background enrichment pass on server startup.
 * Enriches the top 80 most-played unenriched tracks across all users.
 * Completely non-blocking — does NOT delay server startup or request handling.
 */
export function triggerStartupEnrichment(): void {
  if (startupEnrichmentDone) return;
  startupEnrichmentDone = true;

  // Delay 10s to let server fully start before making external API calls
  setTimeout(() => {
    const existing = getMemCache();
    const history = readHistory();
    const unenrichedCount = history.filter(h => !existing[h.trackId]).length;

    if (unenrichedCount === 0) {
      console.log('[Enrichment] Startup: all history tracks already enriched, skipping.');
      return;
    }

    console.log(`[Enrichment] Startup: found ${unenrichedCount} unenriched tracks — enriching top 80 in background...`);
    enrichHistoryBatch(undefined, 80).catch(err => {
      console.error('[Enrichment] Startup enrichment error:', err);
    });
  }, 10_000);
}
