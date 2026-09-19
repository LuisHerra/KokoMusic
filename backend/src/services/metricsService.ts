/**
 * Metrics Service — contadores in-memory ligeros
 *
 * No sustituye a un sistema de observabilidad real (Prometheus/Datadog),
 * pero da visibilidad inmediata en /api/health sobre qué fuentes están
 * fallando sin tener que ir a mirar logs a mano.
 */

const counters = new Map<string, number>();
const startedAt = Date.now();

function inc(key: string): void {
  counters.set(key, (counters.get(key) || 0) + 1);
}

export const metrics = {
  /** Registra un resultado de búsqueda de metadatos por fuente (itunes|deezer|db|youtube|lyrics) */
  recordSearchSource(source: string, hit: boolean): void {
    inc(`search:${source}:${hit ? 'hit' : 'miss'}`);
  },

  /** Registra un resultado de resolución de stream (KokoMusic-lite) */
  recordStreamResolution(result: 'hit' | 'cached' | 'miss' | 'error'): void {
    inc(`stream:resolve:${result}`);
  },

  /** Registra si el proxy de audio hacia el navegador se completó o no */
  recordStreamProxy(result: 'ok' | 'error'): void {
    inc(`stream:proxy:${result}`);
  },

  snapshot(): Record<string, unknown> {
    const bySource: Record<string, { hit: number; miss: number }> = {};
    const streamResolve: Record<string, number> = {};
    const streamProxy: Record<string, number> = {};

    for (const [key, value] of counters.entries()) {
      const [group, a, b] = key.split(':');
      if (group === 'search') {
        bySource[a] = bySource[a] || { hit: 0, miss: 0 };
        bySource[a][b as 'hit' | 'miss'] = value;
      } else if (group === 'stream' && a === 'resolve') {
        streamResolve[b] = value;
      } else if (group === 'stream' && a === 'proxy') {
        streamProxy[b] = value;
      }
    }

    return {
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      searchBySource: bySource,
      streamResolve,
      streamProxy,
    };
  },
};
