#!/data/data/com.termux/files/usr/bin/bash
# ═══════════════════════════════════════════════════════════
#  KokoMusic — Termux Setup Script
#  Ejecutar una sola vez en Termux para configurar todo.
#
#  Uso:
#    curl -sL https://raw.githubusercontent.com/TU_USUARIO/KokoMusic/main/scripts/termux/setup.sh | bash
#
#  El INSTALL_TOKEN te lo manda el administrador de la app.
# ═══════════════════════════════════════════════════════════

set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
step()  { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

# ── Key Vault ─────────────────────────────────────────────
CONFIG_URL="https://sptdttocpixdexguxirb.supabase.co/functions/v1/get-config"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║      🎵  KokoMusic — Termux Setup       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Pedir token de instalación ────────────────────────
echo -e "${YELLOW}Introduce el token de instalación que te dio el administrador:${NC}"
read -rp "  INSTALL_TOKEN: " INSTALL_TOKEN
[ -z "$INSTALL_TOKEN" ] && error "Token requerido."

# ── 2. Instalar curl y jq antes de usarlos ───────────────
step "Preparando herramientas..."
pkg update -y -q && pkg install -y curl jq 2>/dev/null || true

# ── 3. Descargar configuración del Key Vault ─────────────
step "Descargando configuración desde el servidor..."

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "x-install-token: ${INSTALL_TOKEN}" \
  "${CONFIG_URL}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" != "200" ]; then
  ERR=$(echo "$BODY" | jq -r '.error // "Error desconocido"' 2>/dev/null || echo "$BODY")
  error "Error del servidor ($HTTP_CODE): $ERR"
fi

ok "Configuración descargada"

# Helper para extraer valores
get_val() { echo "$BODY" | jq -r ".config.$1 // \"\""; }

# ── 4. Actualizar Termux ─────────────────────────────────
step "Actualizando Termux..."
pkg update -y && pkg upgrade -y
ok "Termux actualizado"

# ── 5. Instalar dependencias del sistema ─────────────────
step "Instalando Node.js, Python, ffmpeg y git..."
pkg install -y nodejs python ffmpeg git
ok "Dependencias instaladas"

# ── 6. Instalar yt-dlp ───────────────────────────────────
step "Instalando yt-dlp..."
pip install -U yt-dlp
ok "yt-dlp $(yt-dlp --version)"

# ── 7. Clonar repositorio ────────────────────────────────
REPO_DIR="$HOME/kokomusic"
step "Preparando repositorio en $REPO_DIR..."
if [ -d "$REPO_DIR/.git" ]; then
  warn "Ya existe. Actualizando..."
  git -C "$REPO_DIR" pull
else
  git clone https://github.com/LuisHerra/KokoMusic.git "$REPO_DIR" 2>/dev/null \
    || { warn "Repo privado — creando estructura manualmente"; mkdir -p "$REPO_DIR/backend"; }
fi
ok "Repositorio listo"

# ── 8. Escribir .env con las keys del vault ──────────────
step "Escribiendo configuración en .env..."
ENV_FILE="$REPO_DIR/backend/.env"
AUDIO_DIR_PATH="$REPO_DIR/backend/audio_cache"

cat > "$ENV_FILE" << ENVEOF
# KokoMusic — generado por setup.sh
PORT=$(get_val PORT)
NODE_ENV=$(get_val NODE_ENV)
SERVE_FRONTEND=true

SPOTIFY_CLIENT_ID=$(get_val SPOTIFY_CLIENT_ID)
SPOTIFY_CLIENT_SECRET=$(get_val SPOTIFY_CLIENT_SECRET)
SPOTIFY_REDIRECT_URI=$(get_val SPOTIFY_REDIRECT_URI)
FRONTEND_URI=$(get_val FRONTEND_URI)

AUDIO_DIR=${AUDIO_DIR_PATH}
AUDIO_BITRATE=$(get_val AUDIO_BITRATE)
AUDIO_VBR=$(get_val AUDIO_VBR)
AUDIO_COMPRESSION_LEVEL=$(get_val AUDIO_COMPRESSION_LEVEL)
AUDIO_SAMPLE_RATE=$(get_val AUDIO_SAMPLE_RATE)

CORS_ORIGIN=$(get_val CORS_ORIGIN)

SUPABASE_URL=$(get_val SUPABASE_URL)
SUPABASE_SERVICE_KEY=$(get_val SUPABASE_SERVICE_KEY)

LASTFM_KEY=$(get_val LASTFM_KEY)
TICKETMASTER_KEY=$(get_val TICKETMASTER_KEY)

CF_ACCOUNT_ID=$(get_val CF_ACCOUNT_ID)
R2_ACCESS_KEY_ID=$(get_val R2_ACCESS_KEY_ID)
R2_SECRET_ACCESS_KEY=$(get_val R2_SECRET_ACCESS_KEY)
R2_BUCKET_NAME=$(get_val R2_BUCKET_NAME)
R2_CDN_URL=$(get_val R2_CDN_URL)

CDN_MAX_FILE_MB=$(get_val CDN_MAX_FILE_MB)
CDN_BUCKET_CAPACITY_MB=$(get_val CDN_BUCKET_CAPACITY_MB)
CDN_REQUEST_WARN=$(get_val CDN_REQUEST_WARN)
CDN_STORAGE_WARN_MB=$(get_val CDN_STORAGE_WARN_MB)
ENVEOF

chmod 600 "$ENV_FILE"
ok ".env escrito con permisos seguros (600 — solo lectura de propietario)"

# ── 9. Instalar dependencias npm ─────────────────────────
step "Instalando dependencias del backend..."
cd "$REPO_DIR/backend"
npm install --omit=dev
ok "node_modules listo"

# ── 10. Compilar TypeScript ──────────────────────────────
step "Compilando TypeScript..."
npm run build 2>/dev/null || npx tsc || warn "Compilación con advertencias (puede ser normal)"
ok "Backend compilado"

# ── 11. Crear directorios de datos ───────────────────────
mkdir -p "$REPO_DIR/backend/audio_cache" "$REPO_DIR/backend/data/uploads"

# ── 12. Script de arranque diario ─────────────────────────
START_SCRIPT="$HOME/start-kokomusic.sh"
cat > "$START_SCRIPT" << 'STARTEOF'
#!/data/data/com.termux/files/usr/bin/bash
echo ""
echo "🎵 KokoMusic arrancando..."
cd "$HOME/kokomusic/backend"
yt-dlp -U --quiet 2>/dev/null &
node dist/app.js
STARTEOF
chmod +x "$START_SCRIPT"
ok "Script de arranque: ~/start-kokomusic.sh"

# ── 13. Termux:Boot (autostart al encender) ───────────────
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/kokomusic.sh" << 'BOOTEOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
sleep 8
cd "$HOME/kokomusic/backend"
node dist/app.js >> "$HOME/koko.log" 2>&1 &
BOOTEOF
chmod +x "$BOOT_DIR/kokomusic.sh"
ok "Autostart configurado (requiere Termux:Boot de F-Droid)"

# ── Resumen final ─────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         ✅  Setup completado             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Iniciar:    ${CYAN}bash ~/start-kokomusic.sh${NC}"
echo -e "  Abrir:      ${CYAN}http://localhost:3001${NC} en Chrome"
echo -e "  Instalar:   Chrome → ⋮ → 'Añadir a pantalla de inicio'"
echo ""
echo -e "  ⚡ Para autostart instala ${YELLOW}Termux:Boot${NC} de F-Droid"
echo ""
