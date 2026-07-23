#!/bin/bash
# ==============================================================================
# KokoMusic — Script de Instalación Simplificado para Termux (Android)
# Previene todos los errores de paquetes nativos, Python, FFmpeg y permisos en Android.
# ==============================================================================

set -e

echo ""
echo "=========================================================="
echo " 🎵 KokoMusic — Instalador Automático para Termux (Android)"
echo "=========================================================="
echo ""

# 1. Configurar almacenamiento de Termux
if [ -d "$HOME/storage" ]; then
    echo "✅ Permisos de almacenamiento en Android ya configurados."
else
    echo "📱 Solicitando permisos de almacenamiento en Android (toca Permitir)..."
    termux-setup-storage || true
fi

# 2. Actualizar paquetes del sistema Termux
echo ""
echo "📦 1/5 Actualizando paquetes del sistema Termux..."
pkg update -y && pkg upgrade -y

# 3. Instalar herramientas clave (Node.js, Python, FFmpeg, Git)
echo ""
echo "🛠️ 2/5 Instalando Node.js, Python, FFmpeg y dependencias de red..."
pkg install -y nodejs-lts python ffmpeg git build-essential ca-certificates libjpeg-turbo

# 4. Instalar y actualizar yt-dlp para streaming sin errores
echo ""
echo "⚡ 3/5 Instalando yt-dlp para extracción de audio en Android..."
pip install --upgrade pip
pip install --upgrade yt-dlp

# 5. Instalar dependencias de Node.js omitiendo librerías binarias nativas incompatibles
echo ""
echo "🔧 4/5 Instalando paquetes de KokoMusic..."
ROOT_DIR=$(pwd)

echo " -> Configurando Backend..."
cd "$ROOT_DIR/backend"
npm install --no-optional --omit=peer

echo " -> Configurando Frontend..."
cd "$ROOT_DIR/frontend"
npm install --no-optional --omit=peer

cd "$ROOT_DIR"

# 6. Crear script ejecutable de inicio rápido (start_termux.sh)
echo ""
echo "🚀 5/5 Creando iniciador de 1 toque (start_termux.sh)..."

cat << 'EOF' > start_termux.sh
#!/bin/bash
ROOT_DIR=$(pwd)

echo ""
echo "=========================================================="
echo " 🚀 Iniciando KokoMusic en Termux (Android)"
echo "=========================================================="
echo " 📱 Servidor Local: http://localhost:5173"
echo " 🔊 Backend Streaming: http://localhost:3001"
echo "=========================================================="
echo ""

# Iniciar backend en segundo plano
cd "$ROOT_DIR/backend" && npm run dev &
BACKEND_PID=$!

# Iniciar frontend en segundo plano
cd "$ROOT_DIR/frontend" && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM EXIT

wait
EOF

chmod +x start_termux.sh

echo ""
echo "=========================================================="
echo " 🎉 ¡INSTALACIÓN EN TERMUX COMPLETADA CON ÉXITO!"
echo "=========================================================="
echo " 👉 Para arrancar KokoMusic en cualquier momento, ejecuta:"
echo "    ./start_termux.sh"
echo "=========================================================="
echo ""
