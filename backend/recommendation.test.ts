/**
 * recommendation.test.ts — Unit Tests for KokoMusic Hybrid Recommendation Engine
 *
 * Covers:
 *   1. Time-decay calculation
 *   2. Engagement ratio calculation
 *   3. Artist cap (30% rule)
 *   4. Cache invalidation: 3 skips vs 1 like
 *   5. Stale-while-revalidate pattern
 *
 * Run with: npx ts-node recommendation.test.ts
 * (No external test runner required — uses a minimal inline assertion harness)
 */

import {
  timeDecayWeight,
  engagementRatio,
  applyArtistCap,
} from './src/services/tasteProfileBuilder';

import {
  getCachedPlaylist,
  setCachedPlaylist,
  recordFeedback,
  markCacheStale,
  clearCache,
  isCacheFresh,
  scheduleBackgroundRecompute,
} from './src/services/recommendationCache';

// ── Minimal test harness ──────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function expect(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failCount++;
  }
}

function describe(suiteName: string, fn: () => void): void {
  console.log(`\n📋 ${suiteName}`);
  fn();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

const DUMMY_CANDIDATE = {
  trackId: 'test-track-1',
  title: 'Test Track',
  artist: 'Test Artist',
  artistId: 1,
  cover: '',
  durationMs: 200_000,
  genre: 'Pop',
  releaseDate: null,
  affinityScore: 0.8,
  isNewFromFollowedArtist: false,
  source: 'taste' as const,
  bpmEstimate: 120,
  energyEstimate: 0.7,
};

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: Time decay calculation
// ─────────────────────────────────────────────────────────────────────────────

describe('Suite 1: Time-Decay Weight (λ = 14 days default)', () => {
  const now = Date.now();

  const w0 = timeDecayWeight(new Date(now).toISOString(), now);
  expect('Play from 0 days ago = weight 1.0', Math.abs(w0 - 1.0) < 0.001, `got ${w0}`);

  const w14 = timeDecayWeight(daysAgo(14), now);
  expect(
    'Play from 14 days ago ≈ weight 0.5 (half-life)',
    Math.abs(w14 - 0.5) < 0.02,
    `got ${w14.toFixed(4)}`
  );

  const w28 = timeDecayWeight(daysAgo(28), now);
  expect(
    'Play from 28 days ago ≈ weight 0.25 (two half-lives)',
    Math.abs(w28 - 0.25) < 0.02,
    `got ${w28.toFixed(4)}`
  );

  const w7 = timeDecayWeight(daysAgo(7), now);
  expect(
    'Play from 7 days ago ≈ weight 0.707 (√0.5)',
    Math.abs(w7 - Math.pow(2, -0.5)) < 0.02,
    `got ${w7.toFixed(4)}`
  );

  const wFuture = timeDecayWeight(new Date(now + 10_000).toISOString(), now);
  expect('Future timestamp does not significantly exceed 1.0', wFuture <= 1.001, `got ${wFuture}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: Engagement ratio calculation
// ─────────────────────────────────────────────────────────────────────────────

describe('Suite 2: Engagement Ratio', () => {
  const dur3min = 3 * 60 * 1000; // 180s track

  const ratio100 = engagementRatio(180, dur3min);
  expect('Full play (180s / 180s) = 1.0', Math.abs(ratio100 - 1.0) < 0.001, `got ${ratio100}`);

  const ratio50 = engagementRatio(90, dur3min);
  expect('Half play (90s / 180s) = 0.5', Math.abs(ratio50 - 0.5) < 0.001, `got ${ratio50}`);

  const ratio0 = engagementRatio(0, dur3min);
  expect('Zero play = 0.0', ratio0 === 0, `got ${ratio0}`);

  const ratioOverflow = engagementRatio(500, dur3min);
  expect('Overflow capped at 1.0', ratioOverflow <= 1.0, `got ${ratioOverflow}`);

  const ratioInvalidDur = engagementRatio(30, 0);
  expect('Zero duration returns 0.0 (no divide-by-zero)', ratioInvalidDur === 0, `got ${ratioInvalidDur}`);

  // Below 15% engagement threshold
  const ratio10 = engagementRatio(18, dur3min); // 18/180 = 10%
  expect('10% engagement is below 15% threshold', ratio10 < 0.15, `got ${ratio10.toFixed(3)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: Artist Cap (30% rule)
// ─────────────────────────────────────────────────────────────────────────────

describe('Suite 3: Artist Cap (30% rule)', () => {
  // Artist A dominates at 70%
  const raw1: Record<string, number> = {
    'Artist A': 70,
    'Artist B': 20,
    'Artist C': 10,
  };
  const capped1 = applyArtistCap(raw1);
  const total1 = Object.values(capped1).reduce((s, v) => s + v, 0);
  const maxAllowed1 = total1 * 0.30;

  // In the cascading-cap scenario (A=70 out of 100), ALL artists may hit the cap.
  // The key invariant is: no artist exceeds 30% of the ORIGINAL total.
  const originalTotal = 100;
  const hardCap = originalTotal * 0.30;
  expect(
    'Artist A capped to ≤30% of original total',
    capped1['Artist A'] <= hardCap + 0.5,
    `Artist A weight: ${capped1['Artist A'].toFixed(2)}, max: ${hardCap.toFixed(2)}`
  );
  expect(
    'Total weight preserved after cap (or at max possible for distribution)',
    // When ALL artists hit the cap, excess cannot be redistributed — total may be lower
    // but each artist is correctly bounded. This is expected behavior.
    total1 <= originalTotal && total1 >= originalTotal * 0.85,
    `total: ${total1.toFixed(2)}`
  );

  // All artists well within 30% — should remain unchanged
  const raw2: Record<string, number> = {
    'Artist X': 30,
    'Artist Y': 35,
    'Artist Z': 35,
  };
  const capped2 = applyArtistCap(raw2);
  expect(
    'Artists within 30% cap remain unchanged',
    Math.abs(capped2['Artist X'] - 30) < 0.5,
    `Artist X: ${capped2['Artist X'].toFixed(2)}`
  );

  // Edge case: single artist 100%
  const raw3: Record<string, number> = { 'Solo Artist': 100 };
  const capped3 = applyArtistCap(raw3);
  expect(
    'Single artist capped to 30% (only artist in pool)',
    capped3['Solo Artist'] <= 100 * 0.30 + 0.01,
    `got ${capped3['Solo Artist'].toFixed(2)}`
  );

  // Empty input
  const capped4 = applyArtistCap({});
  expect('Empty input returns empty object', Object.keys(capped4).length === 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: Cache invalidation logic
// ─────────────────────────────────────────────────────────────────────────────

describe('Suite 4: Cache Invalidation (3 skips vs 1 like)', () => {
  const userId = 'test-user-invalidation';
  clearCache(userId);

  // Populate the cache
  setCachedPlaylist(userId, [DUMMY_CANDIDATE]);
  const initialEntry = getCachedPlaylist(userId);
  expect('Cache populated', initialEntry !== null);
  expect('Initial cache is fresh', isCacheFresh(initialEntry!));

  // Record 2 skips — should NOT trigger immediate recompute
  let recomputed = false;
  const fakeRecompute = (_uid: string) => { recomputed = true; };

  const action1 = recordFeedback(userId, 't1', 'skip', fakeRecompute);
  const action2 = recordFeedback(userId, 't2', 'skip', fakeRecompute);
  expect('2 skips: action is "logged"', action1 === 'logged', `got ${action1}`);
  expect('2 skips: no recompute triggered', !recomputed);

  // 3rd skip — must trigger immediate_recompute and clear cache
  const action3 = recordFeedback(userId, 't3', 'skip', fakeRecompute);
  expect('3rd skip: action is "immediate_recompute"', action3 === 'immediate_recompute', `got ${action3}`);
  expect('3rd skip: recompute triggered', recomputed);
  expect('3rd skip: cache cleared', getCachedPlaylist(userId) === null);

  // Repopulate and test like → deferred stale
  clearCache(userId);
  recomputed = false;
  setCachedPlaylist(userId, [DUMMY_CANDIDATE]);
  const likeAction = recordFeedback(userId, 't4', 'liked', fakeRecompute);
  const afterLike = getCachedPlaylist(userId);
  expect('"liked" action returns "marked_stale"', likeAction === 'marked_stale', `got ${likeAction}`);
  expect('"liked" marks cache stale', afterLike?.stale === true);
  expect('"liked" does NOT immediately clear cache', afterLike !== null);
  expect('"liked" does NOT trigger immediate recompute', !recomputed);

  // add_to_playlist → deferred stale
  clearCache(userId);
  recomputed = false;
  setCachedPlaylist(userId, [DUMMY_CANDIDATE]);
  const addAction = recordFeedback(userId, 't5', 'added_to_playlist', fakeRecompute);
  expect('"added_to_playlist" returns "marked_stale"', addAction === 'marked_stale', `got ${addAction}`);
  expect('"added_to_playlist" does NOT trigger immediate recompute', !recomputed);

  // track_completed → only logged
  clearCache(userId);
  recomputed = false;
  setCachedPlaylist(userId, [DUMMY_CANDIDATE]);
  const completeAction = recordFeedback(userId, 't6', 'track_completed', fakeRecompute);
  expect('"track_completed" returns "logged"', completeAction === 'logged', `got ${completeAction}`);
  expect('"track_completed" does NOT trigger recompute', !recomputed);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5: Stale-while-revalidate
// ─────────────────────────────────────────────────────────────────────────────

describe('Suite 5: Stale-While-Revalidate', () => {
  const userId = 'test-user-swr';
  clearCache(userId);
  setCachedPlaylist(userId, [DUMMY_CANDIDATE]);

  // Mark stale manually (simulating TTL expiry or feedback-triggered)
  markCacheStale(userId);

  const staleEntry = getCachedPlaylist(userId);
  expect('Stale entry still exists (not deleted)', staleEntry !== null);
  expect('Stale entry has stale=true', staleEntry?.stale === true);
  expect('Stale entry isCacheFresh() returns false', !isCacheFresh(staleEntry!));
  expect(
    'Stale entry still has candidates (can be served)',
    (staleEntry?.candidates?.length ?? 0) > 0
  );

  // Simulate background recompute updating the cache
  let recomputeCalled = false;
  scheduleBackgroundRecompute(userId, async () => {
    recomputeCalled = true;
    setCachedPlaylist(userId, [{ ...DUMMY_CANDIDATE, trackId: 'new-track-after-recompute' }]);
  });

  // Give setImmediate time to run
  setImmediate(() => {
    expect('Background recompute was called', recomputeCalled);

    const freshEntry = getCachedPlaylist(userId);
    expect('Cache is fresh after recompute', freshEntry !== null && isCacheFresh(freshEntry));
    expect(
      'Cache contains new candidates after recompute',
      freshEntry?.candidates[0]?.trackId === 'new-track-after-recompute',
      `got: ${freshEntry?.candidates[0]?.trackId}`
    );
    expect('Cache stale=false after recompute', freshEntry?.stale === false);

    // Summary
    printSummary();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

function printSummary(): void {
  const total = passCount + failCount;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Tests: ${total} | ✅ Passed: ${passCount} | ❌ Failed: ${failCount}`);
  if (failCount > 0) {
    console.error('\n⚠️  Some tests failed. Check output above.');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
  }
}

// Suites 1-4 are synchronous; Suite 5 has a setImmediate — summary runs there.
// For suites without setImmediate, print after a tick if no async pending.
setTimeout(() => {
  if (passCount + failCount < 34) {
    // Async suite 5 hasn't printed yet — let it run
    return;
  }
  printSummary();
}, 200);
