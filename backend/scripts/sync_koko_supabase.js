/**
 * sync_koko_supabase.js
 *
 * Syncs the extracted Spotify history and taste profile for user 'koko'
 * into Supabase database tables (kokomusic.user_history & kokomusic.taste_profiles).
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('[Sync] Missing Supabase environment credentials.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function syncKokoToSupabase() {
  const profilePath = path.resolve(__dirname, '../data/koko_taste_profile.json');
  const historyPath = path.resolve(__dirname, '../data/user_history.json');

  if (!fs.existsSync(profilePath) || !fs.existsSync(historyPath)) {
    console.error('[Sync] Data files missing.');
    process.exit(1);
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  console.log('[Sync] Seeding Koko taste profile to Supabase...');

  const { error: profileErr } = await supabase
    .schema('kokomusic')
    .from('taste_profiles')
    .upsert({
      user_id: 'koko',
      profile_json: profile,
      computed_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (profileErr) {
    console.error('[Sync] Taste profile upsert error:', profileErr.message);
  } else {
    console.log('[Sync] ✅ Koko taste profile successfully persisted to Supabase kokomusic.taste_profiles!');
  }

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const uniqueMap = new Map();

  history.forEach(item => {
    const key = `${item.artist}-${item.title}`.toLowerCase();
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, {
        user_id: 'koko',
        track_id: item.trackId,
        title: item.title,
        artist: item.artist,
        cover: item.cover || '',
        play_count: item.playCount || 1,
        last_played: item.lastPlayed || new Date().toISOString(),
        plays: item.plays || [item.lastPlayed || new Date().toISOString()],
        session_data: item.minutesBySession || []
      });
    }
  });

  const kokoItems = Array.from(uniqueMap.values());
  console.log(`[Sync] Uploading ${kokoItems.length} unique Spotify history entries to Supabase kokomusic.user_history...`);

  for (let i = 0; i < kokoItems.length; i += 50) {
    const batch = kokoItems.slice(i, i + 50);
    const { error: histErr } = await supabase
      .schema('kokomusic')
      .from('user_history')
      .upsert(batch, { onConflict: 'user_id,track_id' });
    if (histErr) {
      console.error(`[Sync] History batch error at index ${i}:`, histErr.message);
    }
  }

  console.log('[Sync] ✅ All Spotify history records successfully synced to Supabase for account "koko"!');
}

syncKokoToSupabase();
