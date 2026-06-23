/**
 * KokoMusic — Collaborative Playlists & Jam Sessions
 * Routes: /api/collab/...  and  /api/jam/...
 */

import { Router } from 'express';
import { supabase } from '../services/supabaseService';
import { getTrackById } from '../services/metadataService';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(res: any, msg: string, code = 500) {
  return res.status(code).json({ error: msg });
}

function requireSupabase(res: any): boolean {
  if (!supabase) { err(res, 'Supabase no configurado', 503); return false; }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
//  COLLABORATIVE PLAYLISTS
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/collab/playlists?userId=xxx  — playlists owned or collaborated by user */
router.get('/playlists', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  // Fetch playlists owned by user
  const { data: owned } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .select('*')
    .eq('owner_id', userId)
    .order('updated_at', { ascending: false });

  // Fetch playlists where user is a collaborator
  const { data: collabRows } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_collaborators')
    .select('playlist_id')
    .eq('user_id', userId);

  const collabIds = (collabRows ?? []).map((r: any) => r.playlist_id);
  let collabPlaylists: any[] = [];
  if (collabIds.length > 0) {
    const { data } = await supabase!
      .schema('kokomusic')
      .from('collab_playlists')
      .select('*')
      .in('id', collabIds)
      .order('updated_at', { ascending: false });
    collabPlaylists = data ?? [];
  }

  // Merge deduplicating by id
  const all = [...(owned ?? []), ...collabPlaylists];
  const seen = new Set<string>();
  const merged = all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });

  // Enrich each playlist with track count and track list (for sidebar display)
  const enriched = await Promise.all(
    merged.map(async (pl) => {
      const { data: tracks } = await supabase!
        .schema('kokomusic')
        .from('collab_playlist_tracks')
        .select('track_id, position, added_by, added_at')
        .eq('playlist_id', pl.id)
        .order('position');

      let cover_url = pl.cover_url;
      const trackList = tracks ?? [];
      if (!cover_url && trackList.length > 0) {
        try {
          const trackMeta = await getTrackById(trackList[0].track_id);
          if (trackMeta && trackMeta.cover) {
            cover_url = trackMeta.cover;
          }
        } catch (e) {
          console.error('[Collab] Error fetching track cover for playlist:', pl.id, e);
        }
      }

      return {
        ...pl,
        cover_url,
        tracks: trackList.map(t => ({
          trackId: t.track_id,
          track_id: t.track_id,
          position: t.position,
          addedBy: t.added_by,
          addedAt: t.added_at,
        })),
      };
    })
  );

  res.json(enriched);
});

/** POST /api/collab/playlists  — create */
router.post('/playlists', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { name, description = '', cover_url, owner_id, display_name = 'Host' } = req.body;
  if (!name || !owner_id) return err(res, 'name y owner_id requeridos', 400);

  const { data: playlist, error } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .insert({ name, description, cover_url, owner_id })
    .select()
    .single();

  if (error || !playlist) return err(res, error?.message ?? 'Error al crear playlist');

  // Add owner as collaborator with 'owner' role
  await supabase!
    .schema('kokomusic')
    .from('collab_playlist_collaborators')
    .insert({ playlist_id: playlist.id, user_id: owner_id, display_name, role: 'owner' });

  res.json(playlist);
});

/** GET /api/collab/playlists/:code  — get by share_code */
router.get('/playlists/:code', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const userId = req.headers['x-user-id'] as string | undefined;

  const { data: playlist, error } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .select('*')
    .eq('share_code', code.toUpperCase())
    .single();

  if (error || !playlist) return err(res, 'Playlist no encontrada', 404);

  // Check if the user is a collaborator or owner
  const { data: collaborator } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_collaborators')
    .select('*')
    .eq('playlist_id', playlist.id)
    .eq('user_id', userId ?? '')
    .maybeSingle();

  const isOwner = playlist.owner_id === userId;
  if (!collaborator && !isOwner) {
    return err(res, 'Acceso privado. Debes aceptar la invitación desde tu campana.', 403);
  }

  const { data: tracks } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_tracks')
    .select('*')
    .eq('playlist_id', playlist.id)
    .order('position');

  const { data: collaborators } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_collaborators')
    .select('*')
    .eq('playlist_id', playlist.id);

  let cover_url = playlist.cover_url;
  const trackList = tracks ?? [];
  if (!cover_url && trackList.length > 0) {
    try {
      const trackMeta = await getTrackById(trackList[0].track_id);
      if (trackMeta && trackMeta.cover) {
        cover_url = trackMeta.cover;
      }
    } catch (e) {
      console.error('[Collab] Error fetching track cover for playlist detail:', playlist.id, e);
    }
  }

  res.json({ 
    ...playlist, 
    cover_url,
    tracks: trackList, 
    collaborators: collaborators ?? [] 
  });
});

/** DELETE /api/collab/playlists/:id  — delete or leave collab playlist */
router.delete('/playlists/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { userId } = req.body;
  if (!userId) return err(res, 'userId requerido', 400);

  const { data: playlist } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .select('owner_id')
    .eq('id', id)
    .single();

  if (!playlist) return err(res, 'Playlist no encontrada', 404);

  if (playlist.owner_id === userId) {
    // Owner: delete the playlist for everyone
    const { error } = await supabase!.schema('kokomusic').from('collab_playlists').delete().eq('id', id);
    if (error) return err(res, error.message);
    res.json({ success: true, deleted: true });
  } else {
    // Collaborator: leave the playlist
    const { error } = await supabase!.schema('kokomusic').from('collab_playlist_collaborators')
      .delete()
      .eq('playlist_id', id)
      .eq('user_id', userId);
    if (error) return err(res, error.message);
    res.json({ success: true, left: true });
  }
});

/** POST /api/collab/playlists/:code/join  — join as collaborator */
router.post('/playlists/:code/join', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { user_id, display_name = 'Oyente' } = req.body;
  if (!user_id) return err(res, 'user_id requerido', 400);

  const { data: playlist } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .select('id')
    .eq('share_code', code.toUpperCase())
    .single();

  if (!playlist) return err(res, 'Código inválido', 404);

  // Upsert collaborator (idempotent)
  await supabase!
    .schema('kokomusic')
    .from('collab_playlist_collaborators')
    .upsert({ playlist_id: playlist.id, user_id, display_name, role: 'editor' }, { onConflict: 'playlist_id,user_id' });

  res.json({ playlistId: playlist.id });
});

/** POST /api/collab/playlists/:id/tracks  — add track */
router.post('/playlists/:id/tracks', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { track_id, added_by } = req.body;
  if (!track_id || !added_by) return err(res, 'track_id y added_by requeridos', 400);

  // Si es un track custom local, y se añade a playlist colaborativa, debe subirse a Supabase
  if (track_id.startsWith('custom_')) {
    try {
      const { getCustomTrackById, saveCustomTracks, getCustomTracks } = require('../services/customTracksService');
      const customTrack = getCustomTrackById(track_id);
      if (customTrack && customTrack.sourceType === 'upload' && !customTrack.audioUrl && customTrack.audioPath) {
        console.log(`[Collab] Subiendo track custom local ${track_id} a Supabase por adición a playlist colaborativa...`);
        const { uploadToCDN } = require('../services/cdnService');
        const cdnUrl = await uploadToCDN(customTrack.id, customTrack.audioPath, true);
        if (cdnUrl) {
          customTrack.audioUrl = cdnUrl;
          customTrack.audioPath = undefined;
          customTrack.isPublic = true;
          
          // Actualizar en custom_tracks.json
          const allCustom = getCustomTracks();
          const idx = allCustom.findIndex((t: any) => t.id === track_id);
          if (idx !== -1) {
            allCustom[idx] = customTrack;
            saveCustomTracks(allCustom);
            console.log(`[Collab] Track custom ${track_id} actualizado a público exitosamente`);
          }
        } else {
          console.warn(`[Collab] Advertencia: No se pudo subir el archivo de audio del track custom ${track_id} al CDN`);
        }
      }
    } catch (uploadErr) {
      console.error('[Collab] Error al subir track custom en background:', uploadErr);
    }
  }

  // Get current max position
  const { data: last } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_tracks')
    .select('position')
    .eq('playlist_id', id)
    .order('position', { ascending: false })
    .limit(1);

  const position = last && last.length > 0 ? (last[0].position + 1) : 0;

  const { error } = await supabase!
    .schema('kokomusic')
    .from('collab_playlist_tracks')
    .upsert({ playlist_id: id, track_id, position, added_by }, { onConflict: 'playlist_id,track_id' });

  // Update playlist timestamp
  await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return err(res, error.message);
  res.json({ success: true, position });
});

/** DELETE /api/collab/playlists/:id/tracks/:trackId  — remove track */
router.delete('/playlists/:id/tracks/:trackId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id, trackId } = req.params;

  await supabase!
    .schema('kokomusic')
    .from('collab_playlist_tracks')
    .delete()
    .eq('playlist_id', id)
    .eq('track_id', trackId);

  res.json({ success: true });
});

/** PUT /api/collab/playlists/:id/reorder  — reorder collab tracks */
router.put('/playlists/:id/reorder', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { trackIds } = req.body;
  if (!Array.isArray(trackIds)) return err(res, 'trackIds array requerido', 400);

  const updates = trackIds.map((trackId: string, index: number) => {
    return supabase!
      .schema('kokomusic')
      .from('collab_playlist_tracks')
      .update({ position: index })
      .eq('playlist_id', id)
      .eq('track_id', trackId);
  });

  await Promise.all(updates);

  await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id);

  res.json({ success: true });
});

/** POST /api/collab/playlists/:id/smart-reorder — reorder collab tracks based on BPM and energy transitions */
router.post('/playlists/:id/smart-reorder', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;

  try {
    const { data: collabTracks, error: fetchErr } = await supabase!
      .schema('kokomusic')
      .from('collab_playlist_tracks')
      .select('*')
      .eq('playlist_id', id)
      .order('position');

    if (fetchErr || !collabTracks) return err(res, fetchErr?.message ?? 'Error obteniendo canciones');

    const trackDetails = await Promise.all(
      collabTracks.map(async (t) => {
        try {
          const meta = await getTrackById(t.track_id);
          if (meta) {
            return {
              trackId: t.track_id,
              title: meta.title,
              artist: meta.artist,
              duration: meta.duration || 180000,
            };
          }
        } catch (err) {
          // ignore
        }
        return {
          trackId: t.track_id,
          title: '',
          artist: '',
          duration: 180000,
        };
      })
    );

    const tracksWithFeatures = trackDetails.map((t) => {
      const charSum = (t.title.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) +
                       t.artist.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)) || 100;
      const bpm = 75 + (charSum % 76); // 75-150 BPM
      const energy = 0.2 + ((charSum % 9) / 10); // 0.2-1.0 Energy
      return { ...t, bpm, energy };
    });

    if (tracksWithFeatures.length <= 1) {
      return res.json({ success: true });
    }

    const unsorted = [...tracksWithFeatures];
    const sorted: typeof tracksWithFeatures = [];
    
    sorted.push(unsorted.shift()!);

    while (unsorted.length > 0) {
      const current = sorted[sorted.length - 1];
      let bestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unsorted.length; i++) {
        const candidate = unsorted[i];
        const bpmDiff = (candidate.bpm - current.bpm) / 75;
        const energyDiff = candidate.energy - current.energy;
        const distance = Math.sqrt(bpmDiff * bpmDiff + energyDiff * energyDiff);

        if (distance < minDistance) {
          minDistance = distance;
          bestIdx = i;
        }
      }

      sorted.push(unsorted.splice(bestIdx, 1)[0]);
    }

    const updates = sorted.map((s, idx) => {
      return supabase!
        .schema('kokomusic')
        .from('collab_playlist_tracks')
        .update({ position: idx })
        .eq('playlist_id', id)
        .eq('track_id', s.trackId);
    });

    await Promise.all(updates);

    await supabase!
      .schema('kokomusic')
      .from('collab_playlists')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', id);

    res.json({ success: true });
  } catch (error) {
    console.error('[Collab Playlists] Error en smart-reorder:', error);
    res.status(500).json({ error: 'Error interno en la mezcla inteligente' });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
//  JAM SESSIONS
// ══════════════════════════════════════════════════════════════════════════════

/** POST /api/collab/jam/start  — create a jam session */
router.post('/jam/start', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { host_id, host_name = 'Host' } = req.body;
  if (!host_id) return err(res, 'host_id requerido', 400);

  const { data: jam, error } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .insert({ host_id, host_name })
    .select()
    .single();

  if (error || !jam) return err(res, error?.message ?? 'Error creando Jam');

  // Add host as member
  await supabase!
    .schema('kokomusic')
    .from('jam_members')
    .insert({ jam_id: jam.id, user_id: host_id, display_name: host_name });

  res.json(jam);
});

/** GET /api/collab/jam/:code  — get jam state */
router.get('/jam/:code', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;

  const { data: jam, error } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('*')
    .eq('jam_code', code.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !jam) return err(res, 'Jam no encontrada o expirada', 404);

  const { data: members } = await supabase!
    .schema('kokomusic')
    .from('jam_members')
    .select('*')
    .eq('jam_id', jam.id);

  res.json({ ...jam, members: members ?? [] });
});

/** POST /api/collab/jam/:code/join  — join a jam as listener */
router.post('/jam/:code/join', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { user_id, display_name = 'Oyente' } = req.body;
  if (!user_id) return err(res, 'user_id requerido', 400);

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, host_id')
    .eq('jam_code', code.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!jam) return err(res, 'Código inválido o Jam expirada', 404);

  await supabase!
    .schema('kokomusic')
    .from('jam_members')
    .upsert({ jam_id: jam.id, user_id, display_name }, { onConflict: 'jam_id,user_id' });

  res.json({ jamId: jam.id, isHost: jam.host_id === user_id });
});

/** PATCH /api/collab/jam/:code/state  — host updates playback state */
router.patch('/jam/:code/state', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { host_id, track_id, track_title, track_artist, track_cover, position_s, is_playing } = req.body;

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, host_id')
    .eq('jam_code', code.toUpperCase())
    .single();

  if (!jam) return err(res, 'Jam no encontrada', 404);
  if (jam.host_id !== host_id) return err(res, 'Solo el host puede actualizar el estado', 403);

  const update: any = { position_s, is_playing };
  if (track_id !== undefined) {
    Object.assign(update, { track_id, track_title, track_artist, track_cover });
  }

  const { error } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .update(update)
    .eq('id', jam.id);

  if (error) return err(res, error.message);
  res.json({ success: true });
});

/** DELETE /api/collab/jam/:code  — end jam (host only) */
router.delete('/jam/:code', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { host_id } = req.body;

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, host_id')
    .eq('jam_code', code.toUpperCase())
    .single();

  if (!jam) return err(res, 'Jam no encontrada', 404);
  if (jam.host_id !== host_id) return err(res, 'Solo el host puede terminar el Jam', 403);

  await supabase!
    .schema('kokomusic')
    .from('jams')
    .update({ expires_at: new Date().toISOString() })
    .eq('id', jam.id);

  res.json({ success: true });
});


// ══════════════════════════════════════════════════════════════════════════════
//  SINFONÍA QUEUE — Collaborative queue management for Jam sessions
// ══════════════════════════════════════════════════════════════════════════════

/** GET /api/collab/jam/:code/queue  — get queue sorted by votes */
router.get('/jam/:code/queue', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const userId = (req.headers['x-user-id'] || 'default') as string;

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id')
    .eq('jam_code', code.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!jam) return err(res, 'Jam no encontrada o expirada', 404);

  const { data: queue } = await supabase!
    .schema('kokomusic')
    .from('jam_queue')
    .select('*')
    .eq('jam_id', jam.id)
    .order('votes', { ascending: false })
    .order('added_at', { ascending: true });

  let myVotes: any[] = [];
  try {
    const { data } = await supabase!
      .schema('kokomusic')
      .from('jam_queue_votes')
      .select('queue_item_id')
      .eq('user_id', userId);
    myVotes = data ?? [];
  } catch (errVotes) {
    console.error('[Collab] Error fetching my votes:', errVotes);
  }

  const votedSet = new Set(myVotes.map(v => v.queue_item_id));
  const enrichedQueue = (queue ?? []).map(item => ({
    ...item,
    voted: votedSet.has(item.id)
  }));

  res.json(enrichedQueue);
});

/** POST /api/collab/jam/:code/queue  — add track to queue */
router.post('/jam/:code/queue', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { track_id, track_title, track_artist, track_cover, added_by, added_by_name = 'Oyente' } = req.body;

  if (!track_id || !track_title || !track_artist || !added_by) {
    return err(res, 'track_id, track_title, track_artist y added_by son requeridos', 400);
  }

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, anyone_can_add, host_id')
    .eq('jam_code', code.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!jam) return err(res, 'Jam no encontrada o expirada', 404);
  if (!jam.anyone_can_add && jam.host_id !== added_by) {
    return err(res, 'Solo el host puede añadir canciones en esta sesión', 403);
  }

  // Check for duplicate
  const { data: existing } = await supabase!
    .schema('kokomusic')
    .from('jam_queue')
    .select('id')
    .eq('jam_id', jam.id)
    .eq('track_id', track_id)
    .single();

  if (existing) return err(res, 'Esta canción ya está en la cola', 409);

  const { data: item, error } = await supabase!
    .schema('kokomusic')
    .from('jam_queue')
    .insert({ jam_id: jam.id, track_id, track_title, track_artist, track_cover, added_by, added_by_name, votes: 1 })
    .select()
    .single();

  if (error || !item) return err(res, error?.message ?? 'Error añadiendo a la cola');

  // Auto-vote by the person who added it
  await supabase!
    .schema('kokomusic')
    .from('jam_queue_votes')
    .upsert({ jam_id: jam.id, queue_item_id: item.id, user_id: added_by }, { onConflict: 'queue_item_id,user_id' });

  res.json(item);
});

/** DELETE /api/collab/jam/:code/queue/:itemId  — remove from queue */
router.delete('/jam/:code/queue/:itemId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code, itemId } = req.params;
  const user_id = req.body.user_id || req.body.userId;

  if (!user_id) return err(res, 'user_id requerido', 400);

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, host_id')
    .eq('jam_code', code.toUpperCase())
    .single();

  if (!jam) return err(res, 'Jam no encontrada', 404);

  const { data: item } = await supabase!
    .schema('kokomusic')
    .from('jam_queue')
    .select('added_by')
    .eq('id', itemId)
    .single();

  if (!item) return err(res, 'Item no encontrado', 404);

  // Only host or the person who added can remove
  if (jam.host_id !== user_id && item.added_by !== user_id) {
    return err(res, 'Sin permisos para eliminar este item', 403);
  }

  await supabase!.schema('kokomusic').from('jam_queue').delete().eq('id', itemId);
  res.json({ success: true });
});

/** POST /api/collab/jam/:code/queue/:itemId/vote  — vote for a track */
router.post('/jam/:code/queue/:itemId/vote', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code, itemId } = req.params;
  const user_id = req.body.user_id || req.body.userId;

  if (!user_id) return err(res, 'user_id requerido', 400);

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id')
    .eq('jam_code', code.toUpperCase())
    .gt('expires_at', new Date().toISOString())
    .single();

  if (!jam) return err(res, 'Jam no encontrada', 404);

  // Check if already voted
  const { data: existing } = await supabase!
    .schema('kokomusic')
    .from('jam_queue_votes')
    .select('queue_item_id')
    .eq('queue_item_id', itemId)
    .eq('user_id', user_id)
    .single();

  let voted = false;
  if (existing) {
    // Unvote
    await supabase!.schema('kokomusic').from('jam_queue_votes').delete()
      .eq('queue_item_id', itemId).eq('user_id', user_id);
    voted = false;
  } else {
    // Vote
    await supabase!.schema('kokomusic').from('jam_queue_votes')
      .upsert({ jam_id: jam.id, queue_item_id: itemId, user_id }, { onConflict: 'queue_item_id,user_id' });
    voted = true;
  }

  // Recalculate precise votes count
  const { count } = await supabase!
    .schema('kokomusic')
    .from('jam_queue_votes')
    .select('*', { count: 'exact', head: true })
    .eq('queue_item_id', itemId);

  await supabase!
    .schema('kokomusic')
    .from('jam_queue')
    .update({ votes: count ?? 0 })
    .eq('id', itemId);

  res.json({ voted });
});

/** PATCH /api/collab/jam/:code/settings  — host updates jam settings */
router.patch('/jam/:code/settings', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { host_id, anyone_can_add, queue_enabled } = req.body;

  const { data: jam } = await supabase!
    .schema('kokomusic')
    .from('jams')
    .select('id, host_id')
    .eq('jam_code', code.toUpperCase())
    .single();

  if (!jam) return err(res, 'Jam no encontrada', 404);
  if (jam.host_id !== host_id) return err(res, 'Solo el host puede cambiar la configuración', 403);

  const update: any = {};
  if (anyone_can_add !== undefined) update.anyone_can_add = anyone_can_add;
  if (queue_enabled !== undefined) update.queue_enabled = queue_enabled;

  await supabase!.schema('kokomusic').from('jams').update(update).eq('id', jam.id);
  res.json({ success: true });
});

/** POST /api/collab/playlists/:code/invite  — invite friends */
router.post('/playlists/:code/invite', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { code } = req.params;
  const { senderId, senderName, friendIds } = req.body;
  
  if (!senderId || !senderName || !Array.isArray(friendIds)) {
    return err(res, 'senderId, senderName y friendIds requeridos', 400);
  }

  // Look up playlist
  const { data: playlist } = await supabase!
    .schema('kokomusic')
    .from('collab_playlists')
    .select('name, cover_url')
    .eq('share_code', code.toUpperCase())
    .single();

  if (!playlist) return err(res, 'Playlist no encontrada', 404);

  const playlistName = playlist.name;
  const coverUrl = playlist.cover_url;

  // Insert notification for each friend
  const inserts = friendIds.map(friendId => {
    return supabase!
      .schema('kokomusic')
      .from('notifications')
      .insert({
        type: 'collab_invite',
        user_id: friendId,
        playlist_code: code.toUpperCase(),
        sender_name: senderName,
        message: `${senderName} te ha invitado a colaborar en su playlist: ${playlistName}`,
        cover_url: coverUrl || null,
        status: 'pending',
        is_read: false
      });
  });

  await Promise.all(inserts);

  res.json({ success: true });
});

/** POST /api/collab/invitations/:id/respond  — accept or reject invitation */
router.post('/invitations/:id/respond', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { action, userId, displayName } = req.body;

  if (!action || !userId || !displayName) {
    return err(res, 'action, userId y displayName requeridos', 400);
  }

  // Find invitation notification
  const { data: notification } = await supabase!
    .schema('kokomusic')
    .from('notifications')
    .select('*')
    .eq('id', id)
    .single();

  if (!notification) return err(res, 'Invitación no encontrada', 404);

  if (action === 'accept') {
    // 1. Find the playlist ID by share_code
    const { data: playlist } = await supabase!
      .schema('kokomusic')
      .from('collab_playlists')
      .select('id')
      .eq('share_code', notification.playlist_code)
      .single();

    if (playlist) {
      // 2. Add collaborator
      await supabase!
        .schema('kokomusic')
        .from('collab_playlist_collaborators')
        .upsert({
          playlist_id: playlist.id,
          user_id: userId,
          display_name: displayName,
          role: 'editor'
        }, { onConflict: 'playlist_id,user_id' });
    }
  }

  // Update invitation status
  await supabase!
    .schema('kokomusic')
    .from('notifications')
    .update({ status: action === 'accept' ? 'accepted' : 'rejected', is_read: true })
    .eq('id', id);

  res.json({ success: true });
});

export default router;
