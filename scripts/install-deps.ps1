# ═══════════════════════════════════════════════════════════════════════════════
#  KokoMusic — Instala dependencias del sistema para modo local
#  Ejecutar una sola vez como Administrador.
#  Uso: .\scripts\install-deps.ps1
# ═══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   KokoMusic — Install System Deps   ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

function Check-Install {
  param($name, $winget_id, $altInstall = "")
  Write-Host "  Checking $name..." -NoNewline
  if (Get-Command $name -ErrorAction SilentlyContinue) {
    Write-Host " ✅ ya instalado" -ForegroundColor Green
  } else {
    Write-Host " ⬇️  instalando..." -ForegroundColor Yellow
    if ($altInstall) {
      Invoke-Expression $altInstall
    } else {
      winget install --id $winget_id --silent --accept-source-agreements --accept-package-agreements
    }
    if (Get-Command $name -ErrorAction SilentlyContinue) {
      Write-Host "  ✅ $name instalado correctamente" -ForegroundColor Green
    } else {
      Write-Host "  ⚠️  $name puede requerir reiniciar el terminal" -ForegroundColor Yellow
    }
  }
}

Check-Install "cloudflared" "Cloudflare.cloudflared"
Check-Install "yt-dlp"      "yt-dlp.yt-dlp"
Check-Install "ffmpeg"      "Gyan.FFmpeg"

Write-Host ""
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Listo. Ahora puedes ejecutar:" -ForegroundColor White
Write-Host ""
Write-Host "    .\scripts\start-local.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Si cloudflared, yt-dlp o ffmpeg no se encuentran," -ForegroundColor DarkGray
Write-Host "  cierra y vuelve a abrir el terminal (actualiza el PATH)." -ForegroundColor DarkGray
Write-Host ""
