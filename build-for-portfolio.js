#!/usr/bin/env node
/**
 * build-for-portfolio.js
 * 
 * Script para compilar KokoMusic y actualizar la página Astro en KokoPortfolio.
 * 
 * Uso:
 *   node build-for-portfolio.js [--portfolio-path ../KokoPortfolio]
 * 
 * Qué hace:
 *   1. Compila el frontend de KokoMusic con `npm run build` (base: /kokoMusic/)
 *   2. Copia dist/ → KokoPortfolio/public/kokoMusic/
 *   3. Lee el index.html generado para extraer los nombres de assets con hash
 *   4. Actualiza src/pages/kokoMusic.astro con los nombres correctos
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuración ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const portfolioFlagIdx = args.indexOf('--portfolio-path');
const portfolioRelPath = portfolioFlagIdx !== -1 ? args[portfolioFlagIdx + 1] : '../KokoPortfolio';

const FRONTEND_DIR = path.join(__dirname, 'frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const PORTFOLIO_DIR = path.resolve(__dirname, portfolioRelPath);
const PORTFOLIO_PUBLIC = path.join(PORTFOLIO_DIR, 'public', 'kokoMusic');
const PORTFOLIO_PAGE = path.join(PORTFOLIO_DIR, 'src', 'pages', 'kokoMusic.astro');

console.log('\n🎵 KokoMusic → KokoPortfolio Build Script\n');
console.log(`   Frontend:  ${FRONTEND_DIR}`);
console.log(`   Portfolio: ${PORTFOLIO_DIR}`);
console.log('');

// ── 1. Build frontend ──────────────────────────────────────────────────────────
console.log('📦 Step 1/3: Building KokoMusic frontend...');
try {
  execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });
  console.log('   ✅ Build completed\n');
} catch (err) {
  console.error('   ❌ Build failed:', err.message);
  process.exit(1);
}

// ── 2. Copy dist → public/kokoMusic ───────────────────────────────────────────
console.log('📂 Step 2/3: Copying dist to portfolio public folder...');
if (!fs.existsSync(PORTFOLIO_PUBLIC)) {
  fs.mkdirSync(PORTFOLIO_PUBLIC, { recursive: true });
}

// Clear target dir to remove stale hashed files from previous builds
fs.rmSync(PORTFOLIO_PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PORTFOLIO_PUBLIC, { recursive: true });

// Recursive copy
function copyRecursive(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

copyRecursive(DIST_DIR, PORTFOLIO_PUBLIC);
console.log('   ✅ Files copied\n');

// ── 3. Update kokoMusic.astro with correct hashed asset names ─────────────────
console.log('✏️  Step 3/3: Updating kokoMusic.astro with new asset hashes...');

const generatedHtml = fs.readFileSync(path.join(PORTFOLIO_PUBLIC, 'index.html'), 'utf-8');

const scriptMatch = generatedHtml.match(/src="(\/kokoMusic\/assets\/[^"]+\.js)"/);
const styleMatch = generatedHtml.match(/href="(\/kokoMusic\/assets\/[^"]+\.css)"/);

if (!scriptMatch || !styleMatch) {
  console.error('   ❌ Could not extract asset paths from generated index.html');
  process.exit(1);
}

const jsPath = scriptMatch[1];
const cssPath = styleMatch[1];

console.log(`   JS  → ${jsPath}`);
console.log(`   CSS → ${cssPath}`);

const astroContent = `---
// KokoMusic — Reproductor de música integrado en KokoPortfolio
// Accesible en: /kokoMusic
// ⚠️  Este archivo es autogenerado por build-for-portfolio.js
//    No edites los paths de assets manualmente — ejecuta el script para regenerar.
---
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231DB954'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z'/></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="KokoMusic — Reproductor de música con Spotify API, streaming de audio, letras sincronizadas, modo DJ y más." />
    <title>KokoMusic</title>
    <script type="module" crossorigin src="${jsPath}"></script>
    <link rel="stylesheet" crossorigin href="${cssPath}" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

fs.writeFileSync(PORTFOLIO_PAGE, astroContent, 'utf-8');
console.log('   ✅ kokoMusic.astro updated\n');

console.log('🚀 Done! KokoMusic is ready at /kokoMusic in KokoPortfolio.\n');
console.log('   → Remember to update VITE_API_URL in frontend/.env.production');
console.log('     with your deployed backend URL before building for production.\n');
