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

const app = express();
const PORT = process.env.PORT ?? 3001;

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = [
  // Localhost dev — cualquier puerto
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
  // Portfolio en Vercel (producción)
  process.env.CORS_ORIGIN,
].filter(Boolean);

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

// ── Health check ──────────────────────────────────────────────────────────────
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

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// ── Background Services ──────────────────────────────────────────────────────
startReleaseChecker();
startBackgroundJobs(); // Starts charts pre-fetcher + recommendation pipeline scheduler

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
