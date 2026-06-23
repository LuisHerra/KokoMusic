---
title: KokoMusic Backend
emoji: 🎵
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: KokoMusic API — Node.js + Express + yt-dlp + Spotify
---

# 🎵 KokoMusic Backend

API backend para **KokoMusic**, un reproductor de música con streaming de audio vía YouTube, integración con Spotify y CDN en Cloudflare R2.

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servidor |
| GET | `/api/stream/:id` | Streaming de audio (yt-dlp + CDN) |
| GET | `/api/search?q=` | Búsqueda de canciones (iTunes + YouTube) |
| GET | `/api/tracks/:id` | Metadatos de una canción |
| GET | `/api/playlists` | Playlists del usuario |
| GET | `/api/artist/:name` | Info del artista |
| GET | `/api/album/:id` | Info del álbum |
| GET | `/api/top-artists` | Top artistas |
| GET | `/api/top-tracks` | Top canciones |
| GET | `/api/recommendations` | Recomendaciones personalizadas |
| * | `/api/collab/*` | Sesiones colaborativas (Jam) |
| * | `/api/friends/*` | Sistema de amigos |
| * | `/api/spotify/*` | OAuth + import desde Spotify |

## Variables de entorno requeridas

Añade estas variables en **Settings → Variables** de tu Space:

```
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=https://TU_SPACE.hf.space/api/spotify/callback
FRONTEND_URI=https://TU_PORTFOLIO.vercel.app/kokoMusic
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
CORS_ORIGIN=https://TU_PORTFOLIO.vercel.app
# Opcional — Cloudflare R2 CDN
CF_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_CDN_URL=
```

## Stack técnico

- **Runtime**: Node.js 20
- **Framework**: Express.js + TypeScript
- **Audio**: `yt-dlp` + `ffmpeg` (opus encoding)
- **CDN**: Cloudflare R2 (S3-compatible)
- **DB**: Supabase (PostgreSQL)
- **Música**: iTunes Search API + YouTube
