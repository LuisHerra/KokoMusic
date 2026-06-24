/**
 * KokoMusic — Friends & Messaging API
 * Routes: /api/friends/...
 * All user identification uses Koko Account UUID (from auth.users / koko_device_id)
 */

import { Router } from 'express';
import { supabase } from '../services/supabaseService';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { getUserStatsFromCloud } from '../services/historyService';
import { getTrackById } from '../services/metadataService';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve('data/uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = uuidv4();
    cb(null, `avatar_${uniqueSuffix}${ext}`);
  }
});

const upload = multer({ storage });


function err(res: any, msg: string, code = 500) {
  return res.status(code).json({ error: msg });
}

function requireSupabase(res: any): boolean {
  if (!supabase) { err(res, 'Supabase no configurado', 503); return false; }
  return true;
}

// ── GET /api/friends/accounts ──────────────────────────────────────────────────
// List all available accounts to link (including email from auth.users for dev/test verification)
router.get('/accounts', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { data: profiles, error } = await supabase!
    .schema('kokomusic')
    .from('koko_profiles')
    .select('id, username, display_name, avatar_url, bio')
    .order('display_name', { ascending: true });

  if (error) return err(res, error.message);

  let emailMap: Record<string, string> = {};
  try {
    const { data: { users }, error: authError } = (await supabase!.auth.admin.listUsers()) as any;
    if (!authError && users) {
      users.forEach(u => {
        if (u.id && u.email) {
          emailMap[u.id] = u.email;
        }
      });
    }
  } catch (authErr) {
    console.error('[Supabase Auth listUsers Error]:', authErr);
  }

  const accounts = (profiles ?? []).map(p => ({
    ...p,
    email: emailMap[p.id] || null
  }));

  res.json({ accounts });
});

// ── GET /api/friends/users/search?q=xxx&userId=xxx ─────────────────────────────
// Search users by display_name or username
router.get('/users/search', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { q, userId } = req.query as { q?: string; userId?: string };
  if (!q || q.trim().length < 2) return err(res, 'Query demasiado corta', 400);

  const { data: profiles, error } = await supabase!
    .schema('kokomusic')
    .from('koko_profiles')
    .select('id, username, display_name, avatar_url, bio')
    .or(`display_name.ilike.%${q}%,username.ilike.%${q}%`)
    .neq('id', userId ?? '00000000-0000-0000-0000-000000000000')
    .eq('is_public', true)
    .limit(20);

  if (error) return err(res, error.message);
  res.json({ users: profiles ?? [] });
});

// ── GET /api/friends/profile/:userId ──────────────────────────────────────────
// Get a user profile + their public stats
router.get('/profile/:userId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.params;

  let profile: any = null;
  try {
    const { data } = await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .select('id, username, display_name, avatar_url, bio, is_public, created_at')
      .eq('id', userId)
      .single();
    profile = data;
  } catch (e) {
    // profile might not exist yet
  }

  // Get auth user metadata to sync
  let authMeta: any = null;
  let authEmail = '';
  try {
    const { data: authUser } = await supabase!.auth.admin.getUserById(userId);
    if (authUser?.user) {
      authMeta = authUser.user.user_metadata;
      authEmail = authUser.user.email || '';
    }
  } catch (authErr) {
    console.error('[Sync Profile] getUserById error:', authErr);
  }

  if (authMeta) {
    const metaDisplayName = authMeta.display_name || '';
    const metaAvatarUrl = authMeta.avatar_url || '';
    const defaultDisplayName = authEmail ? authEmail.split('@')[0] : 'Kokoer';

    if (!profile) {
      // Insert new profile
      const { data: newProfile, error: insErr } = await supabase!
        .schema('kokomusic')
        .from('koko_profiles')
        .insert({
          id: userId,
          display_name: metaDisplayName || defaultDisplayName,
          avatar_url: metaAvatarUrl || null,
          is_public: true
        })
        .select('id, username, display_name, avatar_url, bio, is_public, created_at')
        .single();

      if (!insErr && newProfile) {
        profile = newProfile;
      }
    } else {
      // Update if auth has newer/different values
      const updates: any = {};
      if (metaDisplayName && profile.display_name !== metaDisplayName) {
        updates.display_name = metaDisplayName;
      }
      if (metaAvatarUrl && profile.avatar_url !== metaAvatarUrl) {
        updates.avatar_url = metaAvatarUrl;
      }

      if (Object.keys(updates).length > 0) {
        const { data: updatedProfile, error: updErr } = await supabase!
          .schema('kokomusic')
          .from('koko_profiles')
          .update(updates)
          .eq('id', userId)
          .select('id, username, display_name, avatar_url, bio, is_public, created_at')
          .single();

        if (!updErr && updatedProfile) {
          profile = updatedProfile;
        }
      }
    }
  }

  if (!profile) {
    // Fallback guest profile in memory to avoid 404 for guest device IDs
    profile = {
      id: userId,
      username: `guest_${userId.substring(0, 8)}`,
      display_name: 'Oyente Koko',
      avatar_url: null,
      bio: 'Oyente temporal (Invitado)',
      is_public: true,
      created_at: new Date().toISOString()
    };
  }

  // Find common playlists
  let commonPlaylists: any[] = [];
  const { myId } = req.query as { myId?: string };
  if (myId && userId) {
    try {
      const { data: myPlaylists } = await supabase!
        .schema('kokomusic')
        .from('collab_playlist_collaborators')
        .select('playlist_id')
        .eq('user_id', myId);

      const { data: targetPlaylists } = await supabase!
        .schema('kokomusic')
        .from('collab_playlist_collaborators')
        .select('playlist_id')
        .eq('user_id', userId);

      const myIds = new Set((myPlaylists ?? []).map(p => p.playlist_id));
      const commonIds = (targetPlaylists ?? []).map(p => p.playlist_id).filter(id => myIds.has(id));

      if (commonIds.length > 0) {
        const { data: playlists } = await supabase!
          .schema('kokomusic')
          .from('collab_playlists')
          .select('id, name, description, cover_url, owner_id, share_code')
          .in('id', commonIds);
        
        const rawPlaylists = playlists ?? [];
        commonPlaylists = await Promise.all(
          rawPlaylists.map(async (pl) => {
            let cover_url = pl.cover_url;
            if (!cover_url) {
              try {
                const { data: tracks } = await supabase!
                  .schema('kokomusic')
                  .from('collab_playlist_tracks')
                  .select('track_id')
                  .eq('playlist_id', pl.id)
                  .order('position')
                  .limit(1);
                if (tracks && tracks.length > 0) {
                  const trackMeta = await getTrackById(tracks[0].track_id);
                  if (trackMeta && trackMeta.cover) {
                    cover_url = trackMeta.cover;
                  }
                }
              } catch (e) {
                console.error('[Friends API] Error getting track cover:', e);
              }
            }
            return { ...pl, cover_url };
          })
        );
      }
    } catch (collabErr) {
      console.error('Error fetching common playlists:', collabErr);
    }
  }

  // Fetch listening stats from Supabase (cloud = cross-user, works for any userId)
  const cloudStats = await getUserStatsFromCloud(userId);

  let listeningStats: any = null;
  if (cloudStats) {
    listeningStats = {
      totalPlays: cloudStats.totalPlays,
      totalMinutes: Math.round(cloudStats.totalSeconds / 60) || cloudStats.totalPlays * 3,
      favoriteGenre: cloudStats.favoriteGenre,
      topTracks: cloudStats.topTracks.slice(0, 5).map(t => ({
        title: t.title,
        artist: t.artist,
        cover: t.cover,
        playCount: t.plays,
      })),
    };
  }

  // Fetch followed artists count
  let artistFollowsCount = 0;
  try {
    const { count } = await supabase!
      .schema('kokomusic')
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    artistFollowsCount = count || 0;
  } catch (followErr) {
    console.error('Error fetching artist follows count:', followErr);
  }

  res.json({
    profile,
    stats: {
      artistFollowsCount,
      commonPlaylists,
      listeningStats
    }
  });
});


// ── GET /api/friends?userId=xxx ────────────────────────────────────────────────
// Get all accepted friends for a user
router.get('/', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  // Get all accepted friendships where the user is either requester or addressee
  const { data: friendships, error } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted');

  if (error) return err(res, error.message);

  // Collect friend IDs
  const friendIds = (friendships ?? []).map((f: any) =>
    f.requester_id === userId ? f.addressee_id : f.requester_id
  );

  if (friendIds.length === 0) return res.json({ friends: [] });

  // Fetch profiles
  const { data: profiles } = await supabase!
    .schema('kokomusic')
    .from('koko_profiles')
    .select('id, username, display_name, avatar_url, bio')
    .in('id', friendIds);

  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

  const friends = (friendships ?? []).map((f: any) => {
    const friendId = f.requester_id === userId ? f.addressee_id : f.requester_id;
    return {
      friendshipId: f.id,
      since: f.created_at,
      ...profileMap[friendId],
    };
  });

  // Count unread messages per friend
  const { data: unreadData } = await supabase!
    .schema('kokomusic')
    .from('messages')
    .select('sender_id')
    .eq('receiver_id', userId)
    .eq('is_read', false)
    .in('sender_id', friendIds);

  const unreadCounts: Record<string, number> = {};
  for (const msg of unreadData ?? []) {
    unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] ?? 0) + 1;
  }

  res.json({
    friends: friends.map((f: any) => ({ ...f, unreadCount: unreadCounts[f.id] ?? 0 })),
  });
});

// ── GET /api/friends/requests?userId=xxx ──────────────────────────────────────
// Get pending friend requests received by the user
router.get('/requests', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  const { data: requests, error } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id, requester_id, created_at')
    .eq('addressee_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return err(res, error.message);

  const requesterIds = (requests ?? []).map((r: any) => r.requester_id);
  if (requesterIds.length === 0) return res.json({ requests: [] });

  const { data: profiles } = await supabase!
    .schema('kokomusic')
    .from('koko_profiles')
    .select('id, username, display_name, avatar_url')
    .in('id', requesterIds);

  const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

  res.json({
    requests: (requests ?? []).map((r: any) => ({
      requestId: r.id,
      sentAt: r.created_at,
      ...profileMap[r.requester_id],
    })),
  });
});

// ── POST /api/friends/request ──────────────────────────────────────────────────
// Send a friend request
router.post('/request', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { requesterId, addresseeId } = req.body;
  if (!requesterId || !addresseeId) return err(res, 'requesterId y addresseeId requeridos', 400);
  if (requesterId === addresseeId) return err(res, 'No puedes enviarte una solicitud a ti mismo', 400);

  // Check if friendship already exists (in either direction)
  const { data: existing } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id, status')
    .or(
      `and(requester_id.eq.${requesterId},addressee_id.eq.${addresseeId}),and(requester_id.eq.${addresseeId},addressee_id.eq.${requesterId})`
    )
    .single();

  if (existing) {
    if (existing.status === 'accepted') return err(res, 'Ya sois amigos', 409);
    if (existing.status === 'pending') return err(res, 'Solicitud ya enviada', 409);
    if (existing.status === 'blocked') return err(res, 'No se puede enviar solicitud', 403);
  }

  const { data: friendship, error } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .insert({ requester_id: requesterId, addressee_id: addresseeId, status: 'pending' })
    .select()
    .single();

  if (error) return err(res, error.message);
  res.json({ friendship });
});

// ── PATCH /api/friends/request/:id ────────────────────────────────────────────
// Accept or reject a friend request
router.patch('/request/:id', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { id } = req.params;
  const { userId, action } = req.body; // action: 'accept' | 'reject'
  if (!userId || !action) return err(res, 'userId y action requeridos', 400);

  const { data: req_ } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id, addressee_id, status')
    .eq('id', id)
    .single();

  if (!req_) return err(res, 'Solicitud no encontrada', 404);
  if (req_.addressee_id !== userId) return err(res, 'Sin permisos', 403);
  if (req_.status !== 'pending') return err(res, 'Solicitud ya procesada', 409);

  if (action === 'accept') {
    await supabase!
      .schema('kokomusic')
      .from('friendships')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .eq('id', id);
    res.json({ success: true, status: 'accepted' });
  } else {
    // Reject = delete the request
    await supabase!.schema('kokomusic').from('friendships').delete().eq('id', id);
    res.json({ success: true, status: 'rejected' });
  }
});

// ── DELETE /api/friends/:friendId?userId=xxx ───────────────────────────────────
// Remove a friend (unfriend)
router.delete('/:friendId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { friendId } = req.params;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  await supabase!
    .schema('kokomusic')
    .from('friendships')
    .delete()
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`
    );

  res.json({ success: true });
});

// ── GET /api/friends/messages/:friendId?userId=xxx&before=ISO ─────────────────
// Get conversation between two users (paginated, newest first)
router.get('/messages/:friendId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { friendId } = req.params;
  const { userId, before } = req.query as { userId?: string; before?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  let query = supabase!
    .schema('kokomusic')
    .from('messages')
    .select('id, sender_id, receiver_id, content, is_read, created_at')
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`
    )
    .order('created_at', { ascending: false })
    .limit(40);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data: messages, error } = await query;
  if (error) return err(res, error.message);

  // Mark received messages as read
  await supabase!
    .schema('kokomusic')
    .from('messages')
    .update({ is_read: true })
    .eq('sender_id', friendId)
    .eq('receiver_id', userId)
    .eq('is_read', false);

  res.json({ messages: (messages ?? []).reverse() });
});

// ── POST /api/friends/messages ────────────────────────────────────────────────
// Send a message
router.post('/messages', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { senderId, receiverId, content } = req.body;
  if (!senderId || !receiverId || !content?.trim()) return err(res, 'senderId, receiverId y content requeridos', 400);

  // Verify they are friends
  const { data: friendship } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id')
    .or(
      `and(requester_id.eq.${senderId},addressee_id.eq.${receiverId}),and(requester_id.eq.${receiverId},addressee_id.eq.${senderId})`
    )
    .eq('status', 'accepted')
    .single();

  if (!friendship) return err(res, 'Solo puedes enviar mensajes a amigos', 403);

  const { data: message, error } = await supabase!
    .schema('kokomusic')
    .from('messages')
    .insert({ sender_id: senderId, receiver_id: receiverId, content: content.trim() })
    .select()
    .single();

  if (error) return err(res, error.message);
  res.json({ message });
});

// ── GET /api/friends/profile/:userId/artists ──────────────────────────────────
// Get a friend's followed artists (public)
router.get('/profile/:userId/artists', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.params;

  try {
    const { data: follows, error } = await supabase!
      .schema('kokomusic')
      .from('follows')
      .select('artist_id, artist_name, artist_image')
      .eq('user_id', userId)
      .order('followed_at', { ascending: false });

    if (error) {
      console.error('[Friends Route] Error reading follows for target user:', userId, error.message);
      return res.json({ artists: [] });
    }

    const formatted = (follows || []).map((row: any) => ({
      artist_id: row.artist_id,
      artist_name: row.artist_name,
      artist_image: row.artist_image || '',
    }));

    res.json({ artists: formatted });
  } catch (err) {
    console.error('[Friends Route] Unexpected error getting followed artists:', err);
    res.json({ artists: [] });
  }
});

// ── GET /api/friends/status?userId=xxx&targetId=xxx ───────────────────────────
// Get friendship status between two users
router.get('/status', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId, targetId } = req.query as { userId?: string; targetId?: string };
  if (!userId || !targetId) return err(res, 'userId y targetId requeridos', 400);

  const { data: friendship } = await supabase!
    .schema('kokomusic')
    .from('friendships')
    .select('id, status, requester_id, addressee_id')
    .or(
      `and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`
    )
    .single();

  if (!friendship) return res.json({ status: 'none' });

  res.json({
    status: friendship.status,
    friendshipId: friendship.id,
    isSender: friendship.requester_id === userId,
  });
});

// ── POST /api/friends/profile/avatar ──────────────────────────────────────────
// Upload avatar image
router.post('/profile/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return err(res, 'No se proporcionó ningún archivo de imagen', 400);
  }
  const avatarUrl = `/uploads/${req.file.filename}`;
  res.json({ avatarUrl });
});

// ── PATCH /api/friends/profile ─────────────────────────────────────────────────
// Update own profile (display_name, avatar_url, bio)
router.patch('/profile', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId, display_name, avatar_url, bio, username, is_public } = req.body;
  if (!userId) return err(res, 'userId requerido', 400);

  const update: any = { updated_at: new Date().toISOString() };
  if (display_name !== undefined) update.display_name = display_name;
  if (avatar_url !== undefined) update.avatar_url = avatar_url;
  if (bio !== undefined) update.bio = bio;
  if (username !== undefined) update.username = username;
  if (is_public !== undefined) update.is_public = is_public;

  // Check if user is registered in auth.users before attempting DB upsert to avoid foreign key violations
  let isAuthUser = false;
  try {
    const { data: authUser } = await supabase!.auth.admin.getUserById(userId);
    if (authUser?.user) {
      isAuthUser = true;
    }
  } catch (e) {
    // Not an auth user
  }

  if (isAuthUser) {
    const { data, error } = await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .upsert({ id: userId, ...update }, { onConflict: 'id' })
      .select()
      .single();

    if (error) return err(res, error.message);

    // Sync to auth.users raw_user_meta_data
    try {
      const metaUpdates: any = {};
      if (display_name !== undefined) metaUpdates.display_name = display_name;
      if (avatar_url !== undefined) metaUpdates.avatar_url = avatar_url;

      if (Object.keys(metaUpdates).length > 0) {
        await supabase!.auth.admin.updateUserById(userId, {
          user_metadata: metaUpdates
        });
      }
    } catch (authErr) {
      console.error('[Sync Profile Update] updateUserById error:', authErr);
    }

    res.json({ profile: data });
  } else {
    // Return virtual updated profile for guest users
    const mockProfile = {
      id: userId,
      username: username || `guest_${userId.substring(0, 8)}`,
      display_name: display_name || 'Oyente Koko',
      avatar_url: avatar_url || null,
      bio: bio || 'Oyente temporal (Invitado)',
      is_public: is_public !== undefined ? is_public : true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    res.json({ profile: mockProfile });
  }
});

// ── DELETE /api/friends/profile/:userId ───────────────────────────────────────
// Delete user account (messages, friendships, profile, and auth user)
router.delete('/profile/:userId', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.params;
  const { usernameConfirm } = req.body;

  if (!userId) return err(res, 'userId requerido', 400);
  if (!usernameConfirm) return err(res, 'Confirmación de nombre de usuario requerida', 400);

  // 1. Fetch profile to compare username/display name
  const { data: profile, error: fetchErr } = await supabase!
    .schema('kokomusic')
    .from('koko_profiles')
    .select('username, display_name')
    .eq('id', userId)
    .single();

  if (fetchErr || !profile) {
    return err(res, 'Perfil no encontrado', 404);
  }

  const expectedName = (profile.username || profile.display_name || '').trim();
  if (usernameConfirm.trim() !== expectedName) {
    return err(res, 'El nombre de usuario ingresado no coincide con tu perfil', 400);
  }

  try {
    // 2. Delete dependent tables records to prevent foreign key errors
    // A. messages
    await supabase!
      .schema('kokomusic')
      .from('messages')
      .delete()
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);

    // B. friendships
    await supabase!
      .schema('kokomusic')
      .from('friendships')
      .delete()
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    // C. collab_playlist_collaborators
    await supabase!
      .schema('kokomusic')
      .from('collab_playlist_collaborators')
      .delete()
      .eq('user_id', userId);

    // D. jam_members
    await supabase!
      .schema('kokomusic')
      .from('jam_members')
      .delete()
      .eq('user_id', userId);

    // E. jam_queue_votes
    await supabase!
      .schema('kokomusic')
      .from('jam_queue_votes')
      .delete()
      .eq('user_id', userId);

    // F. koko_profiles
    await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .delete()
      .eq('id', userId);

    // G. Delete Auth User from Supabase
    const { error: authDeleteErr } = await supabase!.auth.admin.deleteUser(userId);
    if (authDeleteErr) {
      console.error('[Supabase Auth Delete Error]:', authDeleteErr);
    }

    res.json({ success: true, message: 'Cuenta eliminada con éxito' });
  } catch (error: any) {
    console.error('[Delete Account Error]:', error);
    return err(res, error.message || 'Error al eliminar la cuenta');
  }
});

export default router;
