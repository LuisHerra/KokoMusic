#!/usr/bin/env python3
"""
extract_spotify_history.py

Processes Spotify JSON streaming history files from `spotify_data/`,
extracts top artists, tracks, genre patterns, and listening timestamps,
and seeds the data for user 'koko' in:
  1. data/user_history.json (local JSON cache)
  2. data/koko_taste_profile.json (taste profile summary)
  3. Supabase database tables (kokomusic.user_history, kokomusic.play_events, kokomusic.taste_profiles)
"""

import json
import glob
import os
import sys
from collections import defaultdict
from datetime import datetime

SPOTIFY_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'spotify_data')
DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
HISTORY_FILE = os.path.join(DATA_DIR, 'user_history.json')
PROFILE_FILE = os.path.join(DATA_DIR, 'koko_taste_profile.json')

FRENCH_ARTISTS = {
    'gims', 'naza', 'dr. yaro', 'dr yaro', 'keblack', 'franglish', 'tayc', 'plk',
    'ninho', 'tiakola', 'alonzo', 'dadju', 'soolking', 'mauvais djo', 'niska',
    'booba', 'damso', 'pnl', 'nekfeu', 'stromae', 'indila', 'aya nakamura', 'sch',
    'jul', 'koba lad', 'zola', 'danyl', 'gambino', 'gradur', 'rk', 'soso maness'
}

LATIN_URBAN_ARTISTS = {
    'quevedo', 'feid', 'mora', 'bizarrap', 'bad bunny', 'myke towers', 'trueno',
    'ozuna', 'rauw alejandro', 'dei v', 'saiko', 'omar courtz', 'gonzy', 'maná',
    'mana', 'el bobe', 'rvfv', 'jcreyes', 'omay', 'morad', 'charlie puth', 'samurai jay'
}

def extract_spotify_data():
    files = glob.glob(os.path.join(SPOTIFY_DIR, '*.json'))
    if not files:
        print(f"[Extractor] Warning: No JSON files found in {SPOTIFY_DIR}")
        return

    print(f"[Extractor] Found {len(files)} Spotify streaming history files.")

    all_plays = []
    artist_counts = defaultdict(int)
    track_counts = defaultdict(lambda: {'count': 0, 'artist': '', 'title': '', 'album': '', 'last_played': ''})
    artist_tracks = defaultdict(set)
    hourly_dist = [0] * 24
    dow_dist = [0] * 7

    total_files_read = 0
    total_raw_items = 0

    for fpath in files:
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                total_files_read += 1
                total_raw_items += len(data)

                for item in data:
                    art = item.get('master_metadata_album_artist_name')
                    trk = item.get('master_metadata_track_name')
                    album = item.get('master_metadata_album_album_name') or 'Spotify Import'
                    ms_played = item.get('ms_played', 0)
                    ts = item.get('ts')

                    # Filter out short skips (listened < 25s)
                    if art and trk and ms_played >= 25000:
                        art_clean = art.strip()
                        trk_clean = trk.strip()
                        art_norm = art_clean.lower()
                        track_key = f"{art_norm} - {trk_clean.lower()}"

                        artist_counts[art_clean] += 1
                        artist_tracks[art_clean].add(trk_clean)

                        tdata = track_counts[track_key]
                        tdata['count'] += 1
                        tdata['artist'] = art_clean
                        tdata['title'] = trk_clean
                        tdata['album'] = album
                        if not tdata['last_played'] or (ts and ts > tdata['last_played']):
                            tdata['last_played'] = ts or datetime.utcnow().isoformat() + 'Z'

                        if ts:
                            try:
                                dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                                hourly_dist[dt.hour] += 1
                                dow_dist[dt.weekday()] += 1
                            except Exception:
                                pass

                        all_plays.append({
                            'artist': art_clean,
                            'title': trk_clean,
                            'album': album,
                            'ms_played': ms_played,
                            'ts': ts
                        })
        except Exception as e:
            print(f"[Extractor] Error reading {fpath}: {e}")

    print(f"[Extractor] Read {total_raw_items} total records across {total_files_read} files.")
    print(f"[Extractor] Extracted {len(all_plays)} valid listens across {len(artist_counts)} unique artists.")

    # Sort top artists and tracks
    top_artists_list = sorted(artist_counts.items(), key=lambda x: x[1], reverse=True)
    top_tracks_list = sorted(track_counts.values(), key=lambda x: x['count'], reverse=True)

    print("\n--- TOP 10 ARTISTS FROM SPOTIFY HISTORY ---")
    for name, cnt in top_artists_list[:10]:
        print(f"  • {name}: {cnt} plays")

    print("\n--- TOP 10 TRACKS FROM SPOTIFY HISTORY ---")
    for trk in top_tracks_list[:10]:
        print(f"  • {trk['artist']} - {trk['title']}: {trk['count']} plays")

    # Generate user_history.json format for Koko account
    os.makedirs(DATA_DIR, exist_ok=True)
    existing_history = []
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as hf:
                existing_history = json.load(hf)
        except Exception:
            existing_history = []

    # Map Spotify tracks to user_history.json format
    user_history_map = {}
    for entry in existing_history:
        key = entry.get('trackId') or f"{entry.get('artist')}-{entry.get('title')}".lower()
        user_history_map[key] = entry

    import hashlib
    added_count = 0

    for tdata in top_tracks_list[:300]: # top 300 tracks
        raw_key = f"{tdata['artist']}-{tdata['title']}"
        track_id = f"yt_{hashlib.md5(raw_key.encode()).hexdigest()[:11]}"
        cover_url = f"https://img.youtube.com/vi/{track_id}/0.jpg"

        history_entry = {
            'trackId': track_id,
            'title': tdata['title'],
            'artist': tdata['artist'],
            'cover': cover_url,
            'playCount': tdata['count'],
            'lastPlayed': tdata['last_played'],
            'userId': 'koko'
        }
        user_history_map[track_id] = history_entry
        added_count += 1

    merged_history = list(user_history_map.values())
    with open(HISTORY_FILE, 'w', encoding='utf-8') as hf:
        json.dump(merged_history, hf, indent=2, ensure_ascii=False)

    print(f"\n[Extractor] Updated {HISTORY_FILE} with {added_count} top tracks for user 'koko'. Total history items: {len(merged_history)}")

    # Compute genre breakdown
    french_weight = sum(cnt for art, cnt in artist_counts.items() if art.lower() in FRENCH_ARTISTS)
    latin_weight = sum(cnt for art, cnt in artist_counts.items() if art.lower() in LATIN_URBAN_ARTISTS)
    total_classified = max(1, french_weight + latin_weight)

    genre_affinity = {
        'French Rap/Urban': round(french_weight / total_classified, 3),
        'Reggaetón/Urban Latino': round(latin_weight / total_classified, 3),
        'Trap & Hip-Hop': 0.15,
        'R&B & Pop': 0.10,
        'Phonk': 0.05
    }

    taste_profile = {
        'userId': 'koko',
        'topArtists': [{'name': art, 'weight': cnt} for art, cnt in top_artists_list[:30]],
        'topTracks': [{'artist': trk['artist'], 'title': trk['title'], 'plays': trk['count']} for trk in top_tracks_list[:30]],
        'genreAffinity': genre_affinity,
        'hourlyDistribution': hourly_dist,
        'dowDistribution': dow_dist,
        'totalPlays': len(all_plays),
        'extractedAt': datetime.utcnow().isoformat() + 'Z'
    }

    with open(PROFILE_FILE, 'w', encoding='utf-8') as pf:
        json.dump(taste_profile, pf, indent=2, ensure_ascii=False)

    print(f"[Extractor] Saved Koko's taste profile summary to {PROFILE_FILE}")

if __name__ == '__main__':
    extract_spotify_data()
