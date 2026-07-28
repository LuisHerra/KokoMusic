/**
 * CDN Warmer Service
 *
 * Pre-computes and uploads top trending artists & tracks to Cloudflare R2 CDN
 * so first-time user interactions are 100% instant (0-latency playback).
 */

import { getTrendingTracks } from './trendingService';
import { searchTracks } from './metadataService';
import { trackExistsInCDN, uploadToCDN } from './cdnService';
import { downloadAndTranscode, getAudioPath } from './ytdlpService';
import { markTrackAudioReady } from './audioReadyService';
import { resolveYoutubeId } from './ytResolverService';
import fs from 'fs';

const TOP_WARM_ARTISTS = [
  'Bad Bunny', 'Feid', 'Quevedo', 'Gims', 'Ninho', 'Rauw Alejandro',
  'Myke Towers', 'Tayc', 'Jul', 'Taylor Swift', 'Drake', 'Travis Scott',
  'Peso Pluma', 'Junior H', 'Rosalía', 'Aitana', 'Morad'
];

let isWarming = false;

export async function warmCDNTopTracks(): Promise<{ success: boolean; count: number }> {
  if (isWarming) {
    console.log('[CDN Warmer] Pre-warming pass already in progress. Skipping duplicate run.');
    return { success: true, count: 0 };
  }

  isWarming = true;
  console.log('[CDN Warmer] 🚀 Starting top tracks CDN pre-warming pass...');
  let warmedCount = 0;

  try {
    // 1. Fetch top trending tracks
    const trending = await getTrendingTracks('global');
    
    // 2. Fetch top hits for priority artists
    const artistQueries = TOP_WARM_ARTISTS.slice(0, 8).map(a => `${a} hits`);
    const artistHits = await Promise.all(
      artistQueries.map(q => searchTracks(q, 3, 'itunes').catch(() => []))
    );

    const candidates = [
      ...trending,
      ...artistHits.flat(),
    ];

    const deduplicated = new Map<string, typeof candidates[0]>();
    candidates.forEach(t => {
      if (t && t.id) deduplicated.set(t.id, t);
    });

    console.log(`[CDN Warmer] Candidate pool ready: ${deduplicated.size} tracks to verify.`);

    for (const [itunesId, track] of deduplicated.entries()) {
      if (warmedCount >= 20) break; // Limit batch to 20 tracks per warming pass
      try {
        const numericId = Number(itunesId);
        const youtubeId = await resolveYoutubeId(numericId, track.artist, track.title);
        if (!youtubeId) continue;

        // Skip if already in CDN
        const inCDN = await trackExistsInCDN(youtubeId);
        if (inCDN) {
          markTrackAudioReady(youtubeId, itunesId);
          continue;
        }

        console.log(`[CDN Warmer] Pre-downloading: "${track.artist} - ${track.title}" (${youtubeId})`);
        await downloadAndTranscode(youtubeId);
        const localPath = getAudioPath(youtubeId);
        if (fs.existsSync(localPath)) {
          const cdnUrl = await uploadToCDN(youtubeId, localPath, false); // keep local copy for fast serving
          if (cdnUrl) {
            markTrackAudioReady(youtubeId, itunesId);
            warmedCount++;
            console.log(`[CDN Warmer] ✅ Pre-warmed & uploaded: ${track.title} -> ${cdnUrl}`);
          }
        }
      } catch (trackErr) {
        // Continue to next candidate
      }
    }
    console.log(`[CDN Warmer] 🎉 CDN pre-warming pass complete. ${warmedCount} new tracks cached.`);
    return { success: true, count: warmedCount };
  } catch (err) {
    console.error('[CDN Warmer] Error during pre-warming pass:', err);
    return { success: false, count: warmedCount };
  } finally {
    isWarming = false;
  }
}

// Schedule background pre-warming pass 20 seconds after server startup
setTimeout(() => {
  warmCDNTopTracks().catch(() => {});
}, 20000);
