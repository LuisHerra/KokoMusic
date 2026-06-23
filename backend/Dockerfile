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
COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm install

# ── Directorios de datos persistentes ─────────────────────────────────────────
RUN mkdir -p audio_cache data/uploads

# ── Hugging Face Spaces: el puerto público es 7860 ────────────────────────────
ENV PORT=7860
ENV NODE_ENV=production
ENV AUDIO_DIR=/app/audio_cache

EXPOSE 7860

CMD ["node", "dist/app.js"]

