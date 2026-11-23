#!/usr/bin/env node
/**
 * Compara tiempos de respuesta entre backends (cloud, túnel de Cloudflare, local)
 * para decidir si compensa el túnel. Solo hace peticiones GET de lectura.
 *
 *   node scripts/bench-backends.mjs <base1> [base2 ...] [--rounds 8]
 *   node scripts/bench-backends.mjs https://kokomusic.onrender.com https://mi-tunel.example.com
 *
 * Mide para cada backend:
 *  - health:       latencia de red pura (GET /api/health)
 *  - koko-frio:    búsqueda en catálogo con consultas nuevas (sin caché)
 *  - koko-caliente:la misma consulta repetida (con caché)
 *  - yt-frio:      búsqueda en YouTube con consultas nuevas
 *  - yt-caliente:  la misma consulta de YouTube repetida
 *
 * Las consultas "frías" son distintas para cada backend (los backends comparten
 * la caché de búsquedas de Supabase: repetirlas falsearía al segundo).
 */

const args = process.argv.slice(2);
const roundsIdx = args.indexOf('--rounds');
const ROUNDS = roundsIdx >= 0 ? Number(args.splice(roundsIdx, 2)[1]) : 8;
const bases = args.map((b) => b.replace(/\/api\/?$/, '').replace(/\/$/, ''));
if (!bases.length) {
  console.error('Uso: node scripts/bench-backends.mjs <base1> [base2 ...] [--rounds 8]');
  process.exit(1);
}

const POOL = [
  'bohemian rhapsody', 'hotel california', 'despacito', 'blinding lights', 'shape of you', 'bad guy',
  'rolling in the deep', 'smells like teen spirit', 'billie jean', 'la bicicleta', 'tusa', 'pepas',
  'gasolina', 'stairway to heaven', 'wonderwall', 'take on me', 'levitating', 'as it was',
  'flowers miley', 'ella baila sola', 'la flaca', 'corazon espinado', 'mediterraneo serrat', 'lamento boliviano',
  'feel good inc', 'creep radiohead', 'yellow coldplay', 'numb linkin park', 'dakiti', 'titi me pregunto',
  'quevedo bzrp', 'tqg karol g', 'provenza', 'hips dont lie', 'chandelier sia', 'uptown funk',
  'thriller', 'african queen', 'malamente', 'si te vas', 'una foto', 'la playa la oreja',
];
const shuffled = [...POOL].sort(() => Math.random() - 0.5);
const perBackend = Math.floor(shuffled.length / bases.length);

async function timed(url, timeoutMs = 30_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'cache-control': 'no-cache' } });
    const ttfb = performance.now() - t0;
    await res.arrayBuffer();
    return { ok: res.ok, ms: performance.now() - t0, ttfb };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, ttfb: NaN, error: e.name };
  } finally {
    clearTimeout(timer);
  }
}

const pct = (arr, p) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : NaN;
};

async function bench(base, queries) {
  const out = {};
  const run = async (name, makeUrl, n) => {
    const r = [];
    for (let i = 0; i < n; i++) r.push(await timed(makeUrl(i)));
    out[name] = {
      p50: pct(r.map((x) => x.ms), 50),
      p95: pct(r.map((x) => x.ms), 95),
      ttfb50: pct(r.map((x) => x.ttfb), 50),
      fallos: r.filter((x) => !x.ok).length,
    };
  };
  await timed(`${base}/api/health`); // despertar (Render duerme)
  await run('health', () => `${base}/api/health`, ROUNDS);
  const half = Math.max(1, Math.floor(queries.length / 2));
  const kq = queries.slice(0, half);
  const yq = queries.slice(half);
  await run('koko-frio', (i) => `${base}/api/search?q=${encodeURIComponent(kq[i % kq.length])}&limit=20&source=itunes`, Math.min(ROUNDS, kq.length));
  await run('koko-caliente', () => `${base}/api/search?q=${encodeURIComponent(kq[0])}&limit=20&source=itunes`, ROUNDS);
  await run('yt-frio', (i) => `${base}/api/search?q=${encodeURIComponent(yq[i % yq.length])}&limit=20&source=youtube`, Math.min(ROUNDS, yq.length));
  await run('yt-caliente', () => `${base}/api/search?q=${encodeURIComponent(yq[0])}&limit=20&source=youtube`, ROUNDS);
  return out;
}

const results = {};
for (let b = 0; b < bases.length; b++) {
  const base = bases[b];
  process.stderr.write(`Midiendo ${base} …\n`);
  results[base] = await bench(base, shuffled.slice(b * perBackend, (b + 1) * perBackend));
}

const metrics = ['health', 'koko-frio', 'koko-caliente', 'yt-frio', 'yt-caliente'];
console.log(`\nTiempos en ms (p50 / p95, TTFB p50, fallos) — ${ROUNDS} rondas\n`);
for (const m of metrics) {
  console.log(m);
  for (const base of bases) {
    const r = results[base][m];
    console.log(`  ${base.padEnd(48)} ${String(r.p50).padStart(6)} / ${String(r.p95).padStart(6)}   ttfb ${String(r.ttfb50).padStart(6)}   fallos ${r.fallos}`);
  }
}
console.log('\nJSON:', JSON.stringify(results));
