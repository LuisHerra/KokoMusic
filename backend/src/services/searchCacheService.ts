/**
 * Search Cache Service — L2 Persistent Cache (Supabase)
 *
 * Provides read/write access to the kokomusic.search_cache table.
 * Called by the search route when L1 (in-memory) cache misses.
 *
 * TTL strategy:
 *   - iTunes results: 24h (catalog is stable)
 *   - YouTube results: 6h (trending changes faster)
 *   - Lyrics results: 12h
 */

import { supabase } from './supabaseService';

type SearchSource = 'itunes' | 'youtube' | 'lyrics';

const TTL_SECONDS: Record<SearchSource, number> = {
  itunes: 24 * 60 * 60,   // 24h
  youtube: 6 * 60 * 60,   // 6h
  lyrics: 12 * 60 * 60,   // 12h
};

function buildQueryKey(source: SearchSource, query: string): string {
  return `${source}:${query.toLowerCase().trim()}`;
}

/**
 * Attempt to read search results from Supabase L2 cache.
 * Returns null on miss or if Supabase is not configured.
 */
export async function getSearchCache(
  source: SearchSource,
  query: string
): Promise<any[] | null> {
  if (!supabase) return null;
  const key = buildQueryKey(source, query);
  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('search_cache')
      .select('results_json, expires_at')
      .eq('query_key', key)
      .single();

    if (error || !data) return null;

    // TTL check — treat expired rows as miss
    if (new Date(data.expires_at) < new Date()) {
      // Fire-and-forget delete of expired row
      supabase.schema('kokomusic').from('search_cache').delete().eq('query_key', key).then(() => {});
      return null;
    }

    return data.results_json as any[];
  } catch {
    return null;
  }
}

/**
 * Write search results to Supabase L2 cache.
 * Upserts to handle concurrent writes gracefully.
 */
export async function setSearchCache(
  source: SearchSource,
  query: string,
  results: any[]
): Promise<void> {
  if (!supabase) return;
  const key = buildQueryKey(source, query);
  const ttlSeconds = TTL_SECONDS[source];
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    await supabase
      .schema('kokomusic')
      .from('search_cache')
      .upsert(
        {
          query_key: key,
          source,
          results_json: results,
          cached_at: new Date().toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: 'query_key' }
      );
  } catch {
    // Non-critical — in-memory L1 still serves
  }
}

/**
 * Cleanup expired cache entries.
 * Should be called on server startup (async/deferred).
 */
export async function cleanupExpiredSearchCache(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .schema('kokomusic')
      .from('search_cache')
      .delete()
      .lt('expires_at', new Date().toISOString());
    console.log('[SearchCache] Expired entries cleaned up');
  } catch {
    // Non-critical
  }
}
