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
const skipBuild = args.includes('--skip-build'); // En CI ya se compiló antes

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
if (skipBuild) {
  console.log('✔️  Build omitido (--skip-build)\n');
} else {
  console.log('📦 Step 1/3: Building KokoMusic frontend...');
  try {
    execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });
    console.log('   ✅ Build completed\n');
  } catch (err) {
    console.error('   ❌ Build failed:', err.message);
    process.exit(1);
  }
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

// ── 3. Update kokoMusic.astro from the REAL generated index.html ──────────────
// Antes esto reconstruía el <head> a mano (solo script/style + un favicon
// inline) — cualquier tag nuevo añadido a frontend/index.html (manifest,
// theme-color, apple-touch-icon, más iconos...) nunca llegaba aquí, así que
// la versión embebida en el portfolio jamás tenía <link rel="manifest">
// (bloqueando instalación como PWA/TWA) ni registraba el service worker con
// éxito (sw.js SÍ se pedía desde el JS, pero sin el link de manifest el
// registro quedaba huérfano de metadata). Ahora se copia el <head> REAL
// generado por Vite (ya con paths /kokoMusic/... correctos por el `base`),
// así que cualquier tag futuro se propaga solo.
console.log('✏️  Step 3/3: Updating kokoMusic.astro from generated index.html...');

const generatedHtml = fs.readFileSync(path.join(PORTFOLIO_PUBLIC, 'index.html'), 'utf-8');

const headMatch = generatedHtml.match(/<head>([\s\S]*?)<\/head>/);
const bodyMatch = generatedHtml.match(/<body>([\s\S]*?)<\/body>/);

if (!headMatch || !bodyMatch) {
  console.error('   ❌ Could not extract <head>/<body> from generated index.html');
  process.exit(1);
}

console.log('   ✅ Extracted real <head> (manifest, icons, theme-color, script/style tags included)');

const astroContent = `---
// KokoMusic — Reproductor de música integrado en KokoPortfolio
// Accesible en: /kokoMusic
// ⚠️  Este archivo es autogenerado por build-for-portfolio.js a partir del
//    index.html real que genera Vite — no lo edites a mano, ejecuta el
//    script para regenerarlo.
---
<!doctype html>
<html lang="es">
  <head>${headMatch[1]}</head>
  <body>${bodyMatch[1]}</body>
</html>
`;

fs.writeFileSync(PORTFOLIO_PAGE, astroContent, 'utf-8');
console.log('   ✅ kokoMusic.astro updated\n');

console.log('🚀 Done! KokoMusic is ready at /kokoMusic in KokoPortfolio.\n');
console.log('   → Remember to update VITE_API_URL in frontend/.env.production');
console.log('     with your deployed backend URL before building for production.\n');
