# 🎵 KokoMusic

Reproductor de música académico estilo Spotify. Usa la **Spotify Web API** para metadatos y carátulas, **yt-dlp + FFmpeg** para descargar y transcodificar audio de YouTube, y lo sirve con **HTTP Range Requests** para seeking nativo.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Zustand + React Query |
| Backend | Node.js 20 + Express + TypeScript |
| Metadatos | Spotify Web API (client credentials) |
| Audio | yt-dlp → FFmpeg → Opus 128kbps |
| Caché local | In-memory (Map) — Redis en producción |
| DB local | In-memory playlists — PostgreSQL + Prisma en producción |

## 📱 Instalación en Android (Termux) — 1 Comando Único

Copia y pega este comando en tu terminal de Termux para instalar KokoMusic automáticamente:

```bash
pkg install -y git && git clone https://github.com/LuisHerra/KokoMusic.git && cd KokoMusic && chmod +x install_termux.sh && ./install_termux.sh
```

### 🚀 Arrancar KokoMusic en Termux
Para iniciar la aplicación en cualquier momento:

```bash
cd KokoMusic && ./start_termux.sh
```

---

## Desarrollo local

### Requisitos previos

```bash
# 1. Node.js 20+
node --version  # >= 20

# 2. Python + yt-dlp
pip install yt-dlp

# 3. FFmpeg instalado y en PATH
ffmpeg -version
```

### Credenciales Spotify

1. Ve a [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. **Create App** → rellena nombre y descripción
3. Copia **Client ID** y **Client Secret**
4. Pégalos en `backend/.env`

### Arrancar

```bash
# Terminal 1 — Backend (http://localhost:3001)
cd backend
npm install
npm run dev

# Terminal 2 — Frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

### Variables de entorno

**`backend/.env`**
```env
PORT=3001
SPOTIFY_CLIENT_ID=tu_client_id
SPOTIFY_CLIENT_SECRET=tu_client_secret
AUDIO_DIR=./audio_cache
CORS_ORIGIN=http://localhost:5173
NODE_ENV=development
```

**`frontend/.env`**
```env
VITE_API_URL=http://localhost:3001/api
```

---

## API Reference

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado del servidor |
| `GET` | `/api/search?q=...` | Buscar tracks (Spotify) |
| `GET` | `/api/tracks/:id` | Metadatos de un track |
| `GET` | `/api/stream/:trackId` | Stream de audio (HTTP 206 Range) |
| `GET` | `/api/stream/:trackId/status` | ¿Está cacheado el audio? |
| `GET` | `/api/playlists` | Listar playlists |
| `POST` | `/api/playlists` | Crear playlist |
| `PATCH` | `/api/playlists/:id` | Editar playlist |
| `DELETE` | `/api/playlists/:id` | Eliminar playlist |
| `POST` | `/api/playlists/:id/tracks` | Añadir track |
| `DELETE` | `/api/playlists/:id/tracks/:trackId` | Quitar track |

---

## Decisiones arquitectónicas

### ¿Por qué HTTP Range Requests?
El navegador envía `Range: bytes=X-Y`. El servidor responde `206 Partial Content` con solo ese fragmento. Esto permite hacer **seeking** (saltar a cualquier punto del audio) sin descargar el archivo completo — el mismo mecanismo que usa Spotify y YouTube internamente.

### ¿Por qué Opus?
Mejor calidad/bitrate que MP3: a 128kbps, Opus suena prácticamente idéntico a 192kbps MP3. Soporte nativo en Chrome, Firefox, Edge, Safari 16+. Menor tamaño → caché más rápida.

### ¿Por qué caché en servidor?
yt-dlp + FFmpeg tarda ~15-30 segundos la primera vez. Con caché en disco, la segunda petición del mismo track es inmediata (<50ms). En producción, Redis guarda además las URLs de audio 24h para evitar consultas repetidas a Spotify.

### ¿Por qué Zustand sobre Redux?
Sin boilerplate. El store del reproductor cabe en un solo archivo. La API es idéntica a `useState` pero compartida entre componentes.

### ¿Por qué React Query?
Caché automático de búsquedas, deduplicación de peticiones, loading/error states out of the box. La búsqueda de "Bad Bunny" que se hace dos veces solo llama a la API una vez.

---

## Despliegue en Oracle Cloud (próxima fase)

```bash
# En la VM Ubuntu 22.04 ARM Ampere A1
curl -fsSL https://raw.githubusercontent.com/tu-usuario/kokomusic/main/infra/setup.sh | bash

# Configura dominio, HTTPS y PM2
certbot --nginx -d tudominio.com
pm2 start ecosystem.config.js
```

Ver `infra/setup.sh` para el script completo de instalación.

---

## Funcionalidades implementadas

- [x] Búsqueda Spotify con caché en memoria
- [x] Streaming HTTP 206 Range Requests
- [x] Descarga + transcodificación yt-dlp → Opus 128kbps
- [x] Reproductor con play/pause, seek, volumen, cola
- [x] Navegación anterior/siguiente
- [x] Playlists CRUD (in-memory)
- [x] Añadir/quitar tracks de playlists
- [x] Color dinámico del player según la carátula *(preparado)*
- [x] Skeleton loaders
- [x] Diseño Spotify-inspired con animaciones

## Próximas fases

- [ ] PostgreSQL + Prisma (schema ya definido en `prompt.md`)
- [ ] Redis (interfaz idéntica a `cacheService.ts`)
- [ ] Auth JWT
- [ ] Caché offline IndexedDB (Dexie.js)
- [ ] Media Session API
- [ ] PWA completa
- [ ] Wrapped personal
- [ ] Despliegue Oracle Cloud
