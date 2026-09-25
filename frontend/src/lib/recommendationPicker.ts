/**
 * Selección de "siguientes canciones" a partir de una lista de candidatos ya
 * ordenada (la Radio de YouTube Music viene siempre en el mismo orden para una
 * misma canción, y el backend la cachea). Dos cosas:
 *
 *  1. Excluir lo escuchado hace poco (ventana temporal, no solo la sesión):
 *     antes, al pulsar una canción desde la búsqueda, la cola se construía con
 *     la radio tal cual y podía volver a sonar algo que acababas de escuchar.
 *  2. Modo exploratorio (epsilon-greedy): en cada hueco, con probabilidad ε se
 *     elige un candidato al azar de entre los siguientes en vez del primero.
 *     Así la misma canción no genera siempre exactamente la misma cola. El
 *     usuario puede volver al modo determinista en Perfil → Algoritmo.
 */

const RECENT_KEY = 'koko_recent_played_at';
const REC_MODE_KEY = 'koko_algo_rec_mode';
const RECENT_WINDOW_MS = 90 * 60 * 1000;
const RECENT_MAX_ENTRIES = 300;
const EPSILON = 0.3;
/** El azar solo elige dentro de los primeros N candidatos restantes, para no irse a sugerencias demasiado lejanas. */
const EXPLORATION_WINDOW = 12;

export type RecommendationMode = 'deterministic' | 'exploratory';

export function getRecommendationMode(): RecommendationMode {
  try {
    return localStorage.getItem(REC_MODE_KEY) === 'deterministic' ? 'deterministic' : 'exploratory';
  } catch {
    return 'exploratory';
  }
}

export function setRecommendationMode(mode: RecommendationMode): void {
  try {
    localStorage.setItem(REC_MODE_KEY, mode);
  } catch {}
}

function readRecent(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function markTrackPlayed(trackId: string): void {
  if (!trackId) return;
  const now = Date.now();
  const recent = readRecent();
  recent[trackId] = now;
  // Podar lo que ya salió de la ventana y limitar tamaño.
  const entries = Object.entries(recent)
    .filter(([, at]) => now - at < RECENT_WINDOW_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, RECENT_MAX_ENTRIES);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {}
}

export function getRecentlyPlayedIds(): Set<string> {
  const now = Date.now();
  return new Set(
    Object.entries(readRecent())
      .filter(([, at]) => now - at < RECENT_WINDOW_MS)
      .map(([id]) => id)
  );
}

/**
 * Elige hasta `count` candidatos, quitando `exclude` y lo escuchado hace poco.
 * Si al quitar lo reciente no queda nada, se permite repetir antes que dejar
 * la cola vacía.
 */
export function pickRecommendations<T extends { id: string }>(
  candidates: T[],
  count: number,
  exclude: Iterable<string> = [],
  mode: RecommendationMode = getRecommendationMode()
): T[] {
  const excluded = new Set(exclude);
  const notExcluded = candidates.filter((t) => t?.id && !excluded.has(t.id));
  const recent = getRecentlyPlayedIds();
  const fresh = notExcluded.filter((t) => !recent.has(t.id));
  const pool = fresh.length > 0 ? fresh : notExcluded;

  if (mode === 'deterministic') return pool.slice(0, count);

  const remaining = [...pool];
  const picked: T[] = [];
  while (picked.length < count && remaining.length > 0) {
    let index = 0;
    if (remaining.length > 1 && Math.random() < EPSILON) {
      const window = Math.min(remaining.length, EXPLORATION_WINDOW);
      index = 1 + Math.floor(Math.random() * (window - 1));
    }
    picked.push(remaining.splice(index, 1)[0]);
  }
  return picked;
}
