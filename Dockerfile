# Backend principal construido desde la RAÍZ del repo.
#
# Es el mismo build que backend/Dockerfile, pero con las rutas relativas a la
# raíz, para que Render funcione con su configuración por defecto (Root
# Directory vacío, Dockerfile Path ./Dockerfile, contexto .). El .dockerignore
# de la raíz deja pasar solo lo que hace falta del backend.
# Si cambias uno, cambia también backend/Dockerfile.
FROM node:20-slim

# ── Sistema: ffmpeg + python3 + yt-dlp ────────────────────────────────────────
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    --no-install-recommends \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Dependencias Node + compilar TypeScript (via postinstall: tsc) ─────────────
COPY backend/package*.json ./
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm install

# ── Directorios de datos persistentes ─────────────────────────────────────────
RUN mkdir -p audio_cache data/uploads

ENV PORT=7860
ENV NODE_ENV=production
ENV AUDIO_DIR=/app/audio_cache

EXPOSE 7860

CMD ["node", "dist/app.js"]
