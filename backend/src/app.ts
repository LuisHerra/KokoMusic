/**
 * KokoMusic Backend — app.ts
 * Express principal. Sin base de datos externa para desarrollo local.
 * Arquitectura preparada para escalar: las rutas son independientes
 * y los servicios tienen interfaz idéntica a la versión de producción.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import searchRouter from './routes/search';
import streamRouter from './routes/stream';
import tracksRouter from './routes/tracks';
import playlistsRouter from './routes/playlists';
import artistRouter from './routes/artist';
import albumRouter from './routes/album';
import topArtistsRouter from './routes/topArtists';
import topTracksRouter from './routes/topTracks';
import importRouter from './routes/import';
import { startReleaseChecker } from './services/followService';
import { isCDNEnabled, getCDNUsageStats } from './services/cdnService';
import collabRouter from './routes/collab';
import friendsRouter from './routes/friends';
import recommendationsRouter from './routes/recommendations';
import { startBackgroundJobs } from './services/backgroundJobRunner';

import spotifyRouter from './routes/spotify';

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
const rawOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim().replace(/\/$/, ''))
  : [];

const allowedOrigins = [
  // Localhost dev — cualquier puerto
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
  // Permitir kokoworks.es y subdominios
  /^https?:\/\/(.*\.)?kokoworks\.es$/,
  // Permitir vercel.app y subdominios
  /^https?:\/\/(.*\.)?vercel\.app$/,
  ...rawOrigins,
].filter(Boolean);

console.log('[CORS] Configured origins:', allowedOrigins.map(o => o.toString()));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // curl / SSR / same-origin
      const allowed = allowedOrigins.some((o) =>
        typeof o === 'string' ? o === origin : (o as RegExp).test(origin)
      );
      if (allowed) return callback(null, true);
      callback(new Error(`CORS bloqueado: ${origin}`));
    },
    credentials: true,
  })
);

import path from 'path';

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.resolve('data/uploads')));

// ── Health check & Root dashboard ─────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.send(`
    <html>
      <head>
        <title>KokoMusic API</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #0f0f11; color: #e4e4e7; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: #18181b; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; border: 1px solid #27272a; max-width: 450px; }
          h1 { color: #1db954; margin-top: 0; font-size: 2rem; }
          p { color: #a1a1aa; line-height: 1.6; }
          .badge { display: inline-block; background: #27272a; color: #1db954; padding: 0.25rem 0.75rem; border-radius: 9999px; font-weight: 500; font-size: 0.875rem; border: 1px solid #3f3f46; margin-top: 1rem; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🎵 KokoMusic API</h1>
          <p>El backend de KokoMusic se está ejecutando correctamente en Hugging Face Spaces.</p>
          <div class="badge">Status: Online</div>
        </div>
      </body>
    </html>
  `);
});

app.get('/api', (_req, res) => {
  res.redirect('/api/health');
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    env: process.env.NODE_ENV ?? 'development',
    spotify: !!process.env.SPOTIFY_CLIENT_ID,
    timestamp: new Date().toISOString(),
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/search', searchRouter);
app.use('/api/stream', streamRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/artist', artistRouter);
app.use('/api/album', albumRouter);
app.use('/api/top-artists', topArtistsRouter);
app.use('/api/top-tracks', topTracksRouter);
app.use('/api/import', importRouter);
app.use('/api/collab', collabRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/spotify', spotifyRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// ── Background Services ──────────────────────────────────────────────────────
startReleaseChecker();
startBackgroundJobs(); // Starts charts pre-fetcher + recommendation pipeline scheduler

import { updateYtDlp } from './services/ytdlpService';
updateYtDlp(); // Run yt-dlp updater asynchronously on startup

import { backfillLocalHistoryToCloud } from './services/historyService';

app.listen(PORT, () => {
  console.log(`\n🎵 KokoMusic Backend corriendo en http://localhost:${PORT}`);
  console.log(`   Spotify API: ${process.env.SPOTIFY_CLIENT_ID ? '✅ Configurada' : '⚠️  No configurada (.env)'}`);

  if (isCDNEnabled()) {
    const stats = getCDNUsageStats();
    console.log(`   CDN (R2):   ✅ Activo — Storage: ~${stats.estimatedStorageMB.toFixed(0)} MB | Requests este mes: ${stats.requestsThisMonth.toLocaleString()}`);
  } else {
    console.log(`   CDN (R2):   ⚠️  No configurado — rellena CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY en .env`);
  }

  console.log(`   Docs: GET http://localhost:${PORT}/api/health\n`);
  
  // Asynchronously backfill local user history to Supabase play_events table
  backfillLocalHistoryToCloud()
    .then((res) => {
      if (res.success && res.inserted > 0) {
        console.log(`[Backfill] Completado con éxito. Se insertaron ${res.inserted} reproducciones históricas en Supabase.`);
      }
    })
    .catch((err) => {
      console.error('[Backfill] Error en la migración de historial a Supabase:', err);
    });
});

export default app;
