/**
 * Eureka Mode Route — Shazam Audio Fingerprint Identification via RapidAPI
 *
 * Uses the official Shazam API on RapidAPI to identify songs from microphone audio.
 * Sends raw Base64 audio to POST /songs/detect and resolves song title + artist.
 */

import { Router, Request, Response } from 'express';
import { searchTracks } from '../services/metadataService';

const router = Router();

/**
 * Identify a song via the real Shazam API on RapidAPI.
 * Accepts raw Base64 audio (webm) and returns matched title/artist.
 */
async function identifyViaShazam(base64Audio: string): Promise<{ title: string; artist: string } | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.warn('[Eureka] RAPIDAPI_KEY not set in .env');
    return null;
  }

  try {
    // Shazam /songs/detect expects raw binary audio in body
    // Convert base64 → Buffer → send as raw bytes
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    console.log(`[Eureka] Sending ${audioBuffer.length} bytes to Shazam API...`);

    const res = await fetch('https://shazam.p.rapidapi.com/songs/detect', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'shazam.p.rapidapi.com',
      },
      body: base64Audio, // Shazam detect endpoint accepts base64 string directly
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Eureka] Shazam API HTTP error: ${res.status} — ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as any;
    console.log('[Eureka] Shazam API response track:', data?.track?.title ?? 'no match');

    if (data?.track) {
      return {
        title: data.track.title,
        artist: data.track.subtitle, // Shazam uses "subtitle" for artist
      };
    }

    // No match found
    return null;
  } catch (err) {
    console.error('[Eureka] Error calling Shazam RapidAPI:', err);
    return null;
  }
}

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
    const matched = await identifyViaShazam(audioBase64);

    if (!matched) {
      return res.json({
        success: false,
        error: 'No se reconoció ninguna canción. Asegúrate de que el sonido es claro y vuelve a intentarlo.',
      });
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

    const matchedTrack = results[0];
    return res.json({
      success: true,
      matchConfidence: 0.99,
      track: {
        id: matchedTrack.id,
        trackId: matchedTrack.id,
        title: matched.title,        // Use Shazam's exact title
        artist: matched.artist,       // Use Shazam's exact artist
        album: matchedTrack.album || '',
        cover: matchedTrack.cover || '',
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
