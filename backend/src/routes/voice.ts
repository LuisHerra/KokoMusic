/**
 * Voice Route — transcripción del control por voz con Whisper.
 *
 * El reconocimiento del navegador (Web Speech) solo entiende UN idioma fijo y
 * en Electron ni siquiera funciona. Whisper detecta el idioma solo y aguanta
 * mezclas ("pon Bohemian Rhapsody", "mets Alors on danse"), que es lo normal
 * al pedir canciones. Por defecto usa Groq (rápido y con capa gratuita); con
 * STT_BASE_URL/STT_MODEL vale cualquier API compatible con la de OpenAI.
 */

import { Router, Request, Response } from 'express';

const router = Router();

const API_KEY = process.env.GROQ_API_KEY || process.env.STT_API_KEY || '';
const BASE_URL = (process.env.STT_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const MODEL = process.env.STT_MODEL || 'whisper-large-v3-turbo';

// ~45 s de audio opus en base64; un comando de voz dura bastante menos.
const MAX_AUDIO_BASE64 = 1_500_000;

// Sesga a Whisper hacia el vocabulario de comandos sin fijar idioma.
const PROMPT = 'Pon, reproduce, siguiente, pausa, play, next, skip, joue, mets, suivant. Canción, artista, song, chanson.';

// GET /api/voice/status — el cliente decide si grabar audio o usar Web Speech
router.get('/status', (_req: Request, res: Response) => {
  res.json({ available: !!API_KEY });
});

// POST /api/voice/transcribe — { audioBase64, mimeType } → { text, language }
router.post('/transcribe', async (req: Request, res: Response) => {
  if (!API_KEY) return res.status(503).json({ error: 'no_key' });

  const { audioBase64, mimeType = 'audio/webm' } = req.body || {};
  if (typeof audioBase64 !== 'string' || !audioBase64 || audioBase64.length > MAX_AUDIO_BASE64) {
    return res.status(400).json({ error: 'Audio no válido o demasiado largo.' });
  }

  try {
    const type = String(mimeType).split(';')[0];
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : type.includes('wav') ? 'wav' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type }), `voice.${ext}`);
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    form.append('prompt', PROMPT);

    const upstream = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) {
      console.error('[Voice] STT respondió', upstream.status, await upstream.text().catch(() => ''));
      return res.status(502).json({ error: upstream.status === 429 ? 'quota' : 'upstream' });
    }
    const data = await upstream.json() as { text?: string; language?: string };
    res.json({ text: (data.text || '').trim(), language: data.language || null });
  } catch (err) {
    console.error('[Voice] Error transcribiendo:', err);
    res.status(502).json({ error: 'upstream' });
  }
});

export default router;
