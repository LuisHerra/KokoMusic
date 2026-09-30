/**
 * Eureka Mode Route — Shazam Audio Fingerprint Identification via RapidAPI
 *
 * Uses the official Shazam API on RapidAPI to identify songs from microphone audio.
 * Sends raw Base64 audio to POST /songs/detect and resolves song title + artist.
 */

import { Router, Request, Response } from 'express';
import { searchTracks } from '../services/metadataService';

const router = Router();

interface ShazamResult {
  ok: boolean;
  title?: string;
  artist?: string;
  cover?: string;
  reason?: 'no_key' | 'quota' | 'upstream' | 'no_match';
}

/**
 * Identify a song via the Shazam API on RapidAPI.
 * /songs/detect wants the raw PCM (44100 Hz, mono, 16-bit LE) as a base64 string
 * in a text/plain body, max ~500KB.
 */
async function identifyViaShazam(base64Audio: string): Promise<ShazamResult> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.warn('[Eureka] RAPIDAPI_KEY not set');
    return { ok: false, reason: 'no_key' };
  }

  try {
    console.log(`[Eureka] Sending ${base64Audio.length} base64 chars to Shazam API...`);
    const res = await fetch('https://shazam.p.rapidapi.com/songs/detect', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'shazam.p.rapidapi.com',
      },
      body: base64Audio,
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Eureka] Shazam API HTTP error: ${res.status} — ${errText.slice(0, 200)}`);
      // 429 = cuota mensual agotada; 401/403 = clave o suscripción inválida
      return { ok: false, reason: res.status === 429 || res.status === 403 || res.status === 401 ? 'quota' : 'upstream' };
    }

    const data = await res.json() as any;
    console.log('[Eureka] Shazam API response track:', data?.track?.title ?? 'no match');
    if (!data?.track) return { ok: false, reason: 'no_match' };
    return {
      ok: true,
      title: data.track.title,
      artist: data.track.subtitle, // Shazam uses "subtitle" for artist
      cover: data.track.images?.coverarthq || data.track.images?.coverart,
    };
  } catch (err) {
    console.error('[Eureka] Error calling Shazam RapidAPI:', err);
    return { ok: false, reason: 'upstream' };
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// POST /api/eureka/identify or /api/shazam/identify
router.post('/identify', async (req: Request, res: Response) => {
  try {
    const { audioBase64 } = req.body || {};

    if (!audioBase64) {
      return res.json({
        success: false,
        error: 'No se recibió audio del micrófono. Acerca el dispositivo al altavoz.',
      });
    }

    // 1. Identify via Shazam audio fingerprinting
    if (typeof audioBase64 !== 'string' || audioBase64.length > 700_000) {
      return res.json({ success: false, error: 'Audio no válido o demasiado largo.' });
    }
    const matched = await identifyViaShazam(audioBase64);

    if (!matched.ok) {
      const errors = {
        no_key: 'El reconocimiento de canciones no está configurado en el servidor.',
        quota: 'El servicio de reconocimiento ha alcanzado su límite. Inténtalo más tarde.',
        upstream: 'El servicio de reconocimiento no responde. Inténtalo de nuevo.',
        no_match: 'No se reconoció ninguna canción. Asegúrate de que el sonido es claro y vuelve a intentarlo.',
      } as const;
      return res.json({ success: false, error: errors[matched.reason!] });
    }

    const searchTerm = `${matched.artist} ${matched.title}`;
    console.log(`[Eureka] Identified: "${searchTerm}". Searching metadata...`);

    // 2. Fetch full track metadata (cover, duration, id) from iTunes/Deezer
    const results = await searchTracks(searchTerm, 5, 'itunes', true);

    if (!results || results.length === 0) {
      return res.json({
        success: false,
        error: `Se identificó "${matched.title}" de ${matched.artist} pero no se encontraron detalles.`,
      });
    }

    // No fiarse ciegamente del primer resultado: preferir el que coincide en título y artista
    const nt = norm(matched.title), na = norm(matched.artist);
    const matchedTrack =
      results.find((r: any) => norm(r.title || '') === nt && norm(r.artist || '').includes(na.split(' ')[0])) ||
      results.find((r: any) => norm(r.title || '').includes(nt) || nt.includes(norm(r.title || ''))) ||
      results[0];
    return res.json({
      success: true,
      matchConfidence: 0.99,
      track: {
        id: matchedTrack.id,
        trackId: matchedTrack.id,
        title: matched.title,        // Use Shazam's exact title
        artist: matched.artist,       // Use Shazam's exact artist
        album: matchedTrack.album || '',
        cover: matchedTrack.cover || matched.cover || '',
        duration: matchedTrack.duration || 180000,
        genre: matchedTrack.genre || 'Music',
      }
    });
  } catch (err) {
    console.error('[Eureka] Error identifying audio track:', err);
    return res.status(500).json({ error: 'Error al identificar la canción' });
  }
});

export default router;
