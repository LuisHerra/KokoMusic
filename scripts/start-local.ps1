# ═══════════════════════════════════════════════════════════════════════════════
#  KokoMusic — Local Backend Launcher with Cloudflare Tunnel
#  
#  Uso: .\scripts\start-local.ps1
#
#  Requisitos:
#    - Node.js 20+
#    - cloudflared instalado (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
#    - yt-dlp instalado (pip install yt-dlp o winget install yt-dlp)
#    - ffmpeg instalado (winget install ffmpeg o https://ffmpeg.org/download.html)
#    - backend\.env con las API keys
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

# ── Colores ───────────────────────────────────────────────────────────────────
function Write-Step   { param($msg) Write-Host "`n  ► $msg" -ForegroundColor Cyan }
function Write-OK     { param($msg) Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-Warn   { param($msg) Write-Host "  ⚠️  $msg" -ForegroundColor Yellow }
function Write-Err    { param($msg) Write-Host "  ❌ $msg" -ForegroundColor Red }
function Write-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Magenta
    Write-Host "  ║     🎵  KokoMusic  Local Mode        ║" -ForegroundColor Magenta
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Magenta
    Write-Host ""
}

Write-Banner

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir  = Join-Path $ProjectRoot "backend"
$EnvFile     = Join-Path $BackendDir ".env"
$TunnelFile  = Join-Path $ProjectRoot ".tunnel-url"
$BackendPort = 3001

# ── 1. Verificar .env ─────────────────────────────────────────────────────────
Write-Step "Verificando .env..."
if (-not (Test-Path $EnvFile)) {
    Write-Err ".env no encontrado en backend/.env"
    Write-Host "  Crea el archivo con tus API keys. Ver: backend/.env.example" -ForegroundColor Gray
    exit 1
}
Write-OK ".env encontrado"

# ── 2. Verificar dependencias ─────────────────────────────────────────────────
Write-Step "Verificando dependencias..."

$missing = @()
if (-not (Get-Command "node"        -ErrorAction SilentlyContinue)) { $missing += "node" }
if (-not (Get-Command "cloudflared" -ErrorAction SilentlyContinue)) { $missing += "cloudflared" }
if (-not (Get-Command "yt-dlp"      -ErrorAction SilentlyContinue)) { $missing += "yt-dlp" }
if (-not (Get-Command "ffmpeg"      -ErrorAction SilentlyContinue)) { $missing += "ffmpeg" }

if ($missing.Count -gt 0) {
    Write-Warn "Faltan dependencias: $($missing -join ', ')"
    Write-Host ""
    if ($missing -contains "cloudflared") {
        Write-Host "  Instalar cloudflared:" -ForegroundColor Gray
        Write-Host "    winget install --id Cloudflare.cloudflared" -ForegroundColor DarkGray
    }
    if ($missing -contains "yt-dlp") {
        Write-Host "  Instalar yt-dlp:" -ForegroundColor Gray
        Write-Host "    winget install yt-dlp" -ForegroundColor DarkGray
        Write-Host "    o: pip install yt-dlp" -ForegroundColor DarkGray
    }
    if ($missing -contains "ffmpeg") {
        Write-Host "  Instalar ffmpeg:" -ForegroundColor Gray
        Write-Host "    winget install ffmpeg" -ForegroundColor DarkGray
    }
    Write-Host ""
    
    # Cloudflared es crítico, los demás podemos intentar continuar con warning
    if ($missing -contains "cloudflared" -or $missing -contains "node") {
        Write-Err "Dependencias críticas faltantes. Instálalas y vuelve a intentarlo."
        exit 1
    }
    Write-Warn "Continuando con advertencias..."
} else {
    Write-OK "Todas las dependencias presentes"
}

# ── 3. Instalar node_modules si hace falta ────────────────────────────────────
Write-Step "Verificando node_modules del backend..."
$NodeModules = Join-Path $BackendDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Warn "node_modules no existe, ejecutando npm install..."
    Push-Location $BackendDir
    npm install
    Pop-Location
}
Write-OK "node_modules OK"

# ── 4. Limpiar tunnel url anterior ────────────────────────────────────────────
if (Test-Path $TunnelFile) { Remove-Item $TunnelFile -Force }

# ── 5. Lanzar Backend ─────────────────────────────────────────────────────────
Write-Step "Arrancando backend en puerto $BackendPort..."

$BackendProcess = Start-Process -FilePath "powershell" `
    -ArgumentList "-NoProfile", "-Command", "Set-Location '$BackendDir'; npm run dev" `
    -PassThru `
    -WindowStyle Normal

Write-OK "Backend PID: $($BackendProcess.Id)"

# Esperar a que el backend esté listo
Write-Step "Esperando a que el backend esté disponible..."
$maxRetries = 30
$retry = 0
$backendReady = $false

while ($retry -lt $maxRetries -and -not $backendReady) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$BackendPort/api/health" `
            -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $backendReady = $true
        }
    } catch { }
    $retry++
    Write-Host "  ." -NoNewline -ForegroundColor DarkGray
}

Write-Host ""

if (-not $backendReady) {
    Write-Err "El backend no respondió después de $($maxRetries * 2)s. Revisa la ventana del backend."
    exit 1
}
Write-OK "Backend respondiendo en http://localhost:$BackendPort"

# ── 6. Lanzar Cloudflare Tunnel ───────────────────────────────────────────────
Write-Step "Iniciando Cloudflare Tunnel..."
Write-Host "  (El túnel tarda ~5s en establecerse...)" -ForegroundColor DarkGray

$TunnelLog = Join-Path $ProjectRoot ".tunnel.log"
$TunnelProcess = Start-Process -FilePath "cloudflared" `
    -ArgumentList "tunnel", "--url", "http://localhost:$BackendPort", "--no-autoupdate" `
    -PassThru `
    -RedirectStandardError $TunnelLog `
    -WindowStyle Hidden

Start-Sleep -Seconds 6

# Parsear la URL del túnel del log
$tunnelUrl = $null
$logContent = Get-Content $TunnelLog -ErrorAction SilentlyContinue
foreach ($line in $logContent) {
    if ($line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
        $tunnelUrl = $matches[0]
        break
    }
}

if (-not $tunnelUrl) {
    # Segundo intento con más tiempo
    Start-Sleep -Seconds 5
    $logContent = Get-Content $TunnelLog -ErrorAction SilentlyContinue
    foreach ($line in $logContent) {
        if ($line -match "https://[a-z0-9-]+\.trycloudflare\.com") {
            $tunnelUrl = $matches[0]
            break
        }
    }
}

if ($tunnelUrl) {
    # Guardar la URL para que el frontend la consuma
    $tunnelUrl | Out-File -FilePath $TunnelFile -Encoding UTF8 -NoNewline
    
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║  🌐 Túnel activo:                                           ║" -ForegroundColor Green
    Write-Host "  ║     $($tunnelUrl.PadRight(56))║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Copia esta URL en tu app móvil como VITE_API_URL" -ForegroundColor Yellow
    Write-Host "  o usa el modo de detección automática si está configurado." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Archivo de URL guardado en: .tunnel-url" -ForegroundColor DarkGray
    Write-Host ""

} else {
    Write-Warn "No se pudo detectar la URL del túnel automáticamente."
    Write-Host "  Revisa el archivo .tunnel.log para ver la URL generada." -ForegroundColor Gray
    Write-Host "  El log está en: $TunnelLog" -ForegroundColor DarkGray
}

# ── 7. Info final ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Backend local:    http://localhost:$BackendPort" -ForegroundColor White
if ($tunnelUrl) {
Write-Host "  Túnel público:    $tunnelUrl" -ForegroundColor White
}
Write-Host "  Backend PID:      $($BackendProcess.Id)" -ForegroundColor DarkGray
Write-Host "  Tunnel PID:       $($TunnelProcess.Id)" -ForegroundColor DarkGray
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Pulsa CTRL+C para detener todo." -ForegroundColor DarkGray
Write-Host ""

# ── 8. Esperar y limpiar al salir ─────────────────────────────────────────────
try {
    Wait-Process -Id $BackendProcess.Id
} finally {
    Write-Host "`n  Deteniendo servicios..." -ForegroundColor Yellow
    
    if (-not $BackendProcess.HasExited)  { Stop-Process -Id $BackendProcess.Id  -Force -ErrorAction SilentlyContinue }
    if (-not $TunnelProcess.HasExited)   { Stop-Process -Id $TunnelProcess.Id   -Force -ErrorAction SilentlyContinue }
    
    if (Test-Path $TunnelFile) { Remove-Item $TunnelFile -Force }
    if (Test-Path $TunnelLog)  { Remove-Item $TunnelLog  -Force }
    
    Write-OK "KokoMusic Local detenido limpiamente."
}
