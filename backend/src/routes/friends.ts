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
// Deprecated for security & account isolation (prevents accessing/switching to other accounts)
router.get('/accounts', async (req, res) => {
  res.json({ accounts: [] });
});

// ── POST /api/friends/account/create ──────────────────────────────────────────
// Creates a new isolated user account in Supabase (or local guest profile if offline)
router.post('/account/create', async (req, res) => {
  const { display_name, username, email, password, bio, avatar_url } = req.body;
  const nameToUse = (display_name || username || '').trim();
  if (!nameToUse) {
    return err(res, 'El nombre visible o nombre de usuario es obligatorio', 400);
  }

  const cleanUsername = (username || nameToUse).toLowerCase().replace(/[^a-z0-9_]/g, '');

  if (supabase) {
    try {
      // Check if username is already taken
      if (cleanUsername.length >= 3) {
        const { data: existing } = await supabase
          .schema('kokomusic')
          .from('koko_profiles')
          .select('id')
          .eq('username', cleanUsername)
          .maybeSingle();

        if (existing) {
          return err(res, 'El nombre de usuario ya está en uso. Por favor elige otro.', 400);
        }
      }

      const userEmail = email && email.includes('@')
        ? email.trim()
        : `${cleanUsername}_${Date.now()}@kokomusic.app`;

      const userPassword = password && password.length >= 6 ? password : uuidv4();

      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: userEmail,
        password: userPassword,
        email_confirm: true,
        user_metadata: {
          display_name: nameToUse,
          username: cleanUsername,
          avatar_url: avatar_url || null,
        },
      });

      if (authError) {
        return err(res, authError.message, 400);
      }

      const newUserId = authData.user.id;

      // Create matching koko_profiles record
      const { data: profileData, error: profileErr } = await supabase
        .schema('kokomusic')
        .from('koko_profiles')
        .insert({
          id: newUserId,
          display_name: nameToUse,
          username: cleanUsername,
          avatar_url: avatar_url || null,
          bio: bio || '',
          is_public: true,
        })
        .select()
        .single();

      if (profileErr) {
        console.error('[CreateAccount] Profile insert warning:', profileErr.message);
      }

      return res.json({
        success: true,
        userId: newUserId,
        profile: profileData || {
          id: newUserId,
          display_name: nameToUse,
          username: cleanUsername,
          avatar_url: avatar_url || null,
          bio: bio || '',
        },
      });
    } catch (e: any) {
      console.error('[CreateAccount] Exception:', e);
      return err(res, e.message || 'Error al crear la cuenta', 500);
    }
  } else {
    // Offline mode: generate new isolated guest UUID
    const newUserId = uuidv4();
    const guestProfile = {
      id: newUserId,
      display_name: nameToUse,
      username: cleanUsername,
      avatar_url: avatar_url || null,
      bio: bio || '',
      is_public: true,
      created_at: new Date().toISOString(),
    };
    return res.json({
      success: true,
      userId: newUserId,
      profile: guestProfile,
    });
  }
});

// ── POST /api/friends/account/login ──────────────────────────────────────────
// Login or link an existing KokoMusic account by email/username/password or Account ID
router.post('/account/login', async (req, res) => {
  const { identifier, password, accountId } = req.body;

  const targetIdOrUser = (accountId || identifier || '').trim();
  if (!targetIdOrUser) {
    return err(res, 'Ingresa tu nombre de usuario, email o ID de cuenta', 400);
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetIdOrUser);

  if (supabase) {
    try {
      // 1. Try Supabase auth if password is provided and identifier has '@'
      if (password && targetIdOrUser.includes('@')) {
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
          email: targetIdOrUser,
          password: password,
        });

        if (!authError && authData.user) {
          const { data: profile } = await supabase
            .schema('kokomusic')
            .from('koko_profiles')
            .select('*')
            .eq('id', authData.user.id)
            .maybeSingle();

          return res.json({
            success: true,
            userId: authData.user.id,
            profile: profile || {
              id: authData.user.id,
              display_name: authData.user.user_metadata?.display_name || 'Usuario Koko',
              username: authData.user.user_metadata?.username || targetIdOrUser.split('@')[0],
              avatar_url: authData.user.user_metadata?.avatar_url || null,
            },
          });
        }
      }

      // 2. Search profile by ID or username in kokomusic.koko_profiles
      const cleanTarget = targetIdOrUser.toLowerCase().replace(/[^a-z0-9_-]/g, '');

      let query = supabase
        .schema('kokomusic')
        .from('koko_profiles')
        .select('*');

      if (isUuid) {
        query = query.eq('id', targetIdOrUser);
      } else {
        query = query.eq('username', cleanTarget);
      }

      const { data: profile } = await query.maybeSingle();

      if (profile) {
        return res.json({
          success: true,
          userId: profile.id,
          profile,
        });
      }

      // 3. Fallback: Search by display_name if exact username didn't match
      const { data: fuzzyProfiles } = await supabase
        .schema('kokomusic')
        .from('koko_profiles')
        .select('*')
        .ilike('display_name', cleanTarget)
        .limit(1);

      if (fuzzyProfiles && fuzzyProfiles.length > 0) {
        return res.json({
          success: true,
          userId: fuzzyProfiles[0].id,
          profile: fuzzyProfiles[0],
        });
      }

      return err(res, 'No se encontró ninguna cuenta con esa información', 404);
    } catch (e: any) {
      console.error('[LoginAccount] Exception:', e);
      return err(res, e.message || 'Error al iniciar sesión', 500);
    }
  } else {
    // Offline mode: allow restoring profile using ID or Username string
    const offlineProfile = {
      id: isUuid ? targetIdOrUser : uuidv4(),
      display_name: targetIdOrUser,
      username: targetIdOrUser.toLowerCase().replace(/[^a-z0-9_]/g, ''),
      avatar_url: null,
      bio: 'Cuenta vinculada localmente',
    };
    return res.json({
      success: true,
      userId: offlineProfile.id,
      profile: offlineProfile,
    });
  }
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

// ── BEMUSIC DAILY DROPS ────────────────────────────────────────────────────────

// Helper to calculate posting streak
async function getDailyDropStreak(userId: string): Promise<number> {
  if (!supabase) return 0;
  try {
    const { data: drops } = await supabase
      .schema('kokomusic')
      .from('koko_daily_drops')
      .select('drop_date')
      .eq('user_id', userId)
      .order('drop_date', { ascending: false });

    if (!drops || drops.length === 0) return 0;

    const todayStr = new Date().toISOString().split('T')[0];
    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const dropDates = new Set(drops.map((d: any) => d.drop_date));
    let currentCheck = new Date();

    // Must have dropped today or yesterday to maintain active streak
    if (!dropDates.has(todayStr) && !dropDates.has(yesterdayStr)) {
      return 0;
    }

    if (!dropDates.has(todayStr)) {
      currentCheck = new Date(Date.now() - 86400000);
    }

    let streak = 0;
    while (true) {
      const dateStr = currentCheck.toISOString().split('T')[0];
      if (dropDates.has(dateStr)) {
        streak++;
        currentCheck.setDate(currentCheck.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  } catch (e) {
    console.error('Error calculating streak:', e);
    return 0;
  }
}

// ── POST /api/friends/daily-drop ───────────────────────────────────────────────
// Post or update today's BeMusic song drop
router.post('/daily-drop', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId, trackId, title, artist, cover, caption } = req.body;
  if (!userId || !trackId || !title || !artist) {
    return err(res, 'userId, trackId, title y artist requeridos', 400);
  }

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    // 1. Check if drop already exists for today
    const { data: existing } = await supabase!
      .schema('kokomusic')
      .from('koko_daily_drops')
      .select('id')
      .eq('user_id', userId)
      .eq('drop_date', todayStr)
      .maybeSingle();

    let drop: any;
    if (existing) {
      const { data: updated, error: updateErr } = await supabase!
        .schema('kokomusic')
        .from('koko_daily_drops')
        .update({
          track_id: trackId,
          title,
          artist,
          cover,
          caption: caption || '',
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateErr) return err(res, updateErr.message);
      drop = updated;
    } else {
      const { data: inserted, error: insertErr } = await supabase!
        .schema('kokomusic')
        .from('koko_daily_drops')
        .insert({
          user_id: userId,
          track_id: trackId,
          title,
          artist,
          cover,
          caption: caption || '',
          drop_date: todayStr,
        })
        .select()
        .single();

      if (insertErr) return err(res, insertErr.message);
      drop = inserted;
    }

    const streak = await getDailyDropStreak(userId);
    res.json({ drop, streak, success: true });
  } catch (e: any) {
    console.error('Error posting daily drop:', e);
    err(res, e.message || 'Error al publicar canción del día');
  }
});

// ── GET /api/friends/daily-drops?userId=xxx ─────────────────────────────────────
// Get today's BeMusic feed (locked if user hasn't dropped today)
router.get('/daily-drops', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  const todayStr = new Date().toISOString().split('T')[0];

  try {
    // 1. Fetch user's own drop today
    const { data: myDrop } = await supabase!
      .schema('kokomusic')
      .from('koko_daily_drops')
      .select('*')
      .eq('user_id', userId)
      .eq('drop_date', todayStr)
      .maybeSingle();

    const streak = await getDailyDropStreak(userId);
    const hasUserDroppedToday = !!myDrop;

    // If user hasn't posted today, return locked state
    if (!hasUserDroppedToday) {
      return res.json({
        hasUserDroppedToday: false,
        myDropToday: null,
        streak,
        friendDropsToday: [],
      });
    }

    // 2. Fetch accepted friends
    const { data: friendships } = await supabase!
      .schema('kokomusic')
      .from('friendships')
      .select('requester_id, addressee_id')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .eq('status', 'accepted');

    const friendIds = (friendships ?? []).map((f: any) =>
      f.requester_id === userId ? f.addressee_id : f.requester_id
    );

    const allowedUserIds = [userId, ...friendIds];

    // 3. Fetch today's drops for user + friends
    const { data: drops, error } = await supabase!
      .schema('kokomusic')
      .from('koko_daily_drops')
      .select('*')
      .in('user_id', allowedUserIds)
      .eq('drop_date', todayStr)
      .order('created_at', { ascending: false });

    if (error) return err(res, error.message);

    // Fetch user profiles for drops
    const { data: profiles } = await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', allowedUserIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    // Fetch comments for today's drops
    const dropIds = (drops ?? []).map((d: any) => d.id);
    let commentsByDrop: Record<string, any[]> = {};

    if (dropIds.length > 0) {
      const { data: comments } = await supabase!
        .schema('kokomusic')
        .from('koko_daily_drop_comments')
        .select('*')
        .in('drop_id', dropIds)
        .order('created_at', { ascending: true });

      const commentUserIds = (comments ?? []).map((c: any) => c.user_id);
      const { data: commentProfiles } = await supabase!
        .schema('kokomusic')
        .from('koko_profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', Array.from(new Set(commentUserIds)));

      const cProfileMap = new Map((commentProfiles ?? []).map((p: any) => [p.id, p]));

      for (const c of comments ?? []) {
        if (!commentsByDrop[c.drop_id]) commentsByDrop[c.drop_id] = [];
        commentsByDrop[c.drop_id].push({
          ...c,
          user: cProfileMap.get(c.user_id) || { display_name: 'Usuario' },
        });
      }
    }

    const enrichedDrops = (drops ?? []).map((d: any) => ({
      ...d,
      user: profileMap.get(d.user_id) || { id: d.user_id, username: 'kokoer', display_name: 'Usuario Koko', avatar_url: '' },
      comments: commentsByDrop[d.id] || [],
    }));

    res.json({
      hasUserDroppedToday: true,
      myDropToday: myDrop,
      streak,
      friendDropsToday: enrichedDrops,
    });
  } catch (e: any) {
    console.error('Error getting daily drops:', e);
    err(res, e.message || 'Error al obtener canciones del día');
  }
});

// ── POST /api/friends/daily-drop/comment ───────────────────────────────────────
// Comment on a daily drop
router.post('/daily-drop/comment', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { dropId, userId, content } = req.body;
  if (!dropId || !userId || !content?.trim()) {
    return err(res, 'dropId, userId y content requeridos', 400);
  }

  try {
    const { data: comment, error } = await supabase!
      .schema('kokomusic')
      .from('koko_daily_drop_comments')
      .insert({ drop_id: dropId, user_id: userId, content: content.trim() })
      .select()
      .single();

    if (error) return err(res, error.message);

    const { data: profile } = await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .select('id, username, display_name, avatar_url')
      .eq('id', userId)
      .single();

    res.json({ comment: { ...comment, user: profile } });
  } catch (e: any) {
    console.error('Error posting comment:', e);
    err(res, e.message || 'Error al comentar');
  }
});

// ── GET /api/friends/daily-drop/mine?userId=xxx ────────────────────────────────
// Get personal history of all daily drops
router.get('/daily-drop/mine', async (req, res) => {
  if (!requireSupabase(res)) return;
  const { userId } = req.query as { userId?: string };
  if (!userId) return err(res, 'userId requerido', 400);

  try {
    const { data: drops, error } = await supabase!
      .schema('kokomusic')
      .from('koko_daily_drops')
      .select('*')
      .eq('user_id', userId)
      .order('drop_date', { ascending: false });

    if (error) return err(res, error.message);
    const streak = await getDailyDropStreak(userId);

    res.json({ drops: drops ?? [], streak });
  } catch (e: any) {
    console.error('Error getting my daily drops:', e);
    err(res, e.message || 'Error al obtener tus publicaciones');
  }
});

export default router;
