/**
 * KokoMusic — funciones sociales: canción en vivo a un amigo, cápsulas del
 * tiempo y emblemas del perfil. Rutas: /api/social/...
 * Tablas/columnas: backend/data/migrations/add_social_features.sql
 */

import { Router, Request, Response } from 'express';
import { supabase } from '../services/supabaseService';
import { sendPushToUsers, sendPushToUser } from '../services/pushService';

const router = Router();
const db = () => supabase!.schema('kokomusic');

function userOf(req: Request): string | null {
  const id = (req.headers['x-user-id'] || '') as string;
  return id && id !== 'default' ? id : null;
}

function fail(res: Response, msg: string, code = 500) {
  return res.status(code).json({ error: msg });
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const { data } = await db()
    .from('friendships')
    .select('id')
    .or(`and(requester_id.eq.${a},addressee_id.eq.${b}),and(requester_id.eq.${b},addressee_id.eq.${a})`)
    .eq('status', 'accepted')
    .limit(1);
  return !!data?.length;
}

async function displayName(userId: string): Promise<{ name: string; avatar: string | null }> {
  const { data } = await db().from('koko_profiles').select('username, display_name, avatar_url').eq('id', userId).maybeSingle();
  return { name: data?.display_name || data?.username || 'Un amigo', avatar: data?.avatar_url || null };
}

interface SharedTrack { id: string; title: string; artist: string; cover?: string | null }

function cleanTrack(t: any): SharedTrack | null {
  if (!t?.id || !t?.title) return null;
  return {
    id: String(t.id).slice(0, 120),
    title: String(t.title).slice(0, 200),
    artist: String(t.artist || '').slice(0, 200),
    cover: t.cover ? String(t.cover).slice(0, 500) : null,
  };
}

// ── Ajustes ───────────────────────────────────────────────────────────────────

// GET /api/social/settings
router.get('/settings', async (req, res) => {
  const userId = userOf(req);
  if (!supabase || !userId) return fail(res, 'Sesión requerida', 401);
  const { data } = await db().from('koko_profiles').select('allow_song_drops').eq('id', userId).maybeSingle();
  res.json({ allowSongDrops: data?.allow_song_drops !== false });
});

// PATCH /api/social/settings { allowSongDrops }
router.patch('/settings', async (req, res) => {
  const userId = userOf(req);
  if (!supabase || !userId) return fail(res, 'Sesión requerida', 401);
  const allow = req.body?.allowSongDrops !== false;
  const { error } = await db().from('koko_profiles').update({ allow_song_drops: allow }).eq('id', userId);
  if (error) return fail(res, error.message);
  res.json({ allowSongDrops: allow });
});

// ── Canción en vivo ───────────────────────────────────────────────────────────

// POST /api/social/song-drop { receiverId, track, note? }
router.post('/song-drop', async (req, res) => {
  const senderId = userOf(req);
  if (!supabase || !senderId) return fail(res, 'Sesión requerida', 401);
  const { receiverId, note } = req.body || {};
  const track = cleanTrack(req.body?.track);
  if (!receiverId || !track) return fail(res, 'receiverId y track requeridos', 400);
  if (!(await areFriends(senderId, receiverId))) return fail(res, 'Solo puedes enviar canciones a amigos', 403);

  const { data: target } = await db().from('koko_profiles').select('allow_song_drops').eq('id', receiverId).maybeSingle();
  if (target?.allow_song_drops === false) return fail(res, 'Tu amigo tiene desactivado recibir canciones en vivo', 409);

  const me = await displayName(senderId);
  const text = String(note || '').trim().slice(0, 140);
  const { error } = await db().from('notifications').insert({
    type: 'song_drop',
    user_id: receiverId,
    sender_name: me.name,
    message: text ? `${me.name} te envía "${track.title}": ${text}` : `${me.name} te envía "${track.title}"`,
    track_name: track.title,
    cover_url: track.cover,
    is_read: false,
    payload: { track, senderId, senderAvatar: me.avatar, note: text || null },
  });
  if (error) return fail(res, error.message);
  sendPushToUser(receiverId, {
    title: `${me.name} te envía una canción`,
    body: `${track.title} · ${track.artist}`,
    icon: track.cover || undefined,
    url: '',
    tag: `drop-${senderId}`,
  });
  res.json({ ok: true });
});

// ── Cápsulas del tiempo ───────────────────────────────────────────────────────

const MAX_CAPSULE_TRACKS = 20;

// POST /api/social/capsules { tracks[], message?, openAt, recipientIds?[] }
router.post('/capsules', async (req, res) => {
  const ownerId = userOf(req);
  if (!supabase || !ownerId) return fail(res, 'Sesión requerida', 401);
  const tracks = (Array.isArray(req.body?.tracks) ? req.body.tracks : []).map(cleanTrack).filter(Boolean).slice(0, MAX_CAPSULE_TRACKS);
  const openAt = new Date(req.body?.openAt);
  if (!tracks.length) return fail(res, 'Añade al menos una canción', 400);
  if (isNaN(openAt.getTime()) || openAt.getTime() < Date.now() + 60_000) return fail(res, 'La fecha de apertura debe ser futura', 400);

  const recipients: string[] = Array.isArray(req.body?.recipientIds) ? [...new Set<string>(req.body.recipientIds.map(String))] : [];
  for (const r of recipients) {
    if (r !== ownerId && !(await areFriends(ownerId, r))) return fail(res, 'Solo puedes enviar cápsulas a amigos', 403);
  }
  const { data, error } = await db().from('time_capsules').insert({
    owner_id: ownerId,
    // Sin destinatarios: la cápsula es para uno mismo
    recipient_ids: recipients.length ? recipients : [ownerId],
    tracks,
    message: String(req.body?.message || '').trim().slice(0, 500) || null,
    open_at: openAt.toISOString(),
  }).select().single();
  if (error) return fail(res, error.message);
  res.status(201).json({ capsule: data });
});

// GET /api/social/capsules → { sent, received } (las cerradas sin canciones)
router.get('/capsules', async (req, res) => {
  const userId = userOf(req);
  if (!supabase || !userId) return fail(res, 'Sesión requerida', 401);
  const [{ data: sent }, { data: received }] = await Promise.all([
    db().from('time_capsules').select('*').eq('owner_id', userId).order('open_at', { ascending: true }),
    db().from('time_capsules').select('*').contains('recipient_ids', [userId]).order('open_at', { ascending: true }),
  ]);
  const now = Date.now();
  const ownerIds = [...new Set((received ?? []).map((c: any) => c.owner_id))];
  const { data: owners } = ownerIds.length
    ? await db().from('koko_profiles').select('id, username, display_name, avatar_url').in('id', ownerIds)
    : { data: [] as any[] };
  const ownerMap = new Map((owners ?? []).map((o: any) => [o.id, o]));
  const shape = (c: any) => {
    const open = new Date(c.open_at).getTime() <= now;
    const o: any = ownerMap.get(c.owner_id);
    return {
      id: c.id,
      ownerId: c.owner_id,
      ownerName: o?.display_name || o?.username || null,
      ownerAvatar: o?.avatar_url || null,
      recipientIds: c.recipient_ids,
      message: open || c.owner_id === userId ? c.message : null,
      openAt: c.open_at,
      createdAt: c.created_at,
      isOpen: open,
      trackCount: (c.tracks ?? []).length,
      // El contenido es sorpresa hasta la fecha (salvo para quien la creó)
      tracks: open || c.owner_id === userId ? c.tracks : [],
    };
  };
  res.json({
    sent: (sent ?? []).map(shape),
    received: (received ?? []).filter((c: any) => c.owner_id !== userId || c.recipient_ids.length === 1).map(shape),
  });
});

// DELETE /api/social/capsules/:id (solo quien la creó y antes de abrirse)
router.delete('/capsules/:id', async (req, res) => {
  const userId = userOf(req);
  if (!supabase || !userId) return fail(res, 'Sesión requerida', 401);
  const { error } = await db().from('time_capsules').delete().eq('id', req.params.id).eq('owner_id', userId).eq('delivered', false);
  if (error) return fail(res, error.message);
  res.json({ ok: true });
});

/** Avisa de las cápsulas que ya se pueden abrir. Se ejecuta periódicamente. */
export async function deliverDueCapsules(): Promise<void> {
  if (!supabase) return;
  const { data: due, error } = await db().from('time_capsules').select('*')
    .eq('delivered', false).lte('open_at', new Date().toISOString()).limit(100);
  if (error || !due?.length) return;
  for (const c of due as any[]) {
    // Marcar primero: si dos procesos coinciden solo uno la entrega
    const { data: claimed } = await db().from('time_capsules').update({ delivered: true })
      .eq('id', c.id).eq('delivered', false).select('id');
    if (!claimed?.length) continue;
    const owner = await displayName(c.owner_id);
    const self = c.recipient_ids.length === 1 && c.recipient_ids[0] === c.owner_id;
    const message = self
      ? `Tu cápsula del tiempo ya se puede abrir (${c.tracks.length} canciones)`
      : `${owner.name} te dejó una cápsula del tiempo con ${c.tracks.length} canciones`;
    await db().from('notifications').insert(c.recipient_ids.map((uid: string) => ({
      type: 'time_capsule',
      user_id: uid,
      sender_name: self ? 'Cápsula del tiempo' : owner.name,
      message,
      cover_url: c.tracks[0]?.cover || null,
      is_read: false,
      payload: { capsuleId: c.id },
    })));
    sendPushToUsers(c.recipient_ids, { title: 'Cápsula del tiempo', body: message, url: 'capsules', tag: `capsule-${c.id}` });
  }
}

let capsuleTimer: ReturnType<typeof setInterval> | null = null;
export function startCapsuleDelivery() {
  if (capsuleTimer || !supabase) return;
  capsuleTimer = setInterval(() => { deliverDueCapsules().catch((e) => console.error('[Capsules]', e)); }, 60_000);
  deliverDueCapsules().catch(() => {});
}

// ── Emblemas ──────────────────────────────────────────────────────────────────

interface Badge { id: string; icon: string; label: string; description: string; tier: 'bronze' | 'silver' | 'gold' }

const ARTIST_TIERS: [number, Badge['tier'], string][] = [[500, 'gold', 'Superfan'], [150, 'silver', 'Fan'], [50, 'bronze', 'Oyente fiel']];
const ACHIEVEMENTS: { id: string; icon: string; label: string; metric: 'plays' | 'artists' | 'friends' | 'likes' | 'capsules'; thresholds: [number, number, number] ; unit: string }[] = [
  { id: 'plays', icon: 'plays', label: 'Melómano', metric: 'plays', thresholds: [100, 1000, 5000], unit: 'reproducciones' },
  { id: 'explorer', icon: 'explorer', label: 'Explorador', metric: 'artists', thresholds: [25, 100, 300], unit: 'artistas distintos' },
  { id: 'social', icon: 'social', label: 'Sociable', metric: 'friends', thresholds: [1, 5, 15], unit: 'amigos' },
  { id: 'likes', icon: 'likes', label: 'Corazón fácil', metric: 'likes', thresholds: [10, 100, 500], unit: 'me gusta' },
  { id: 'capsules', icon: 'capsules', label: 'Viajero del tiempo', metric: 'capsules', thresholds: [1, 5, 20], unit: 'cápsulas creadas' },
];

const badgeCache = new Map<string, { at: number; badges: Badge[] }>();

// GET /api/social/badges/:userId
router.get('/badges/:userId', async (req, res) => {
  if (!supabase) return res.json({ badges: [] });
  const { userId } = req.params;
  const hit = badgeCache.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return res.json({ badges: hit.badges });

  try {
    const [{ data: plays }, { count: friends }, { data: liked }, { count: capsules }] = await Promise.all([
      db().from('play_events').select('artist').eq('user_id', userId).limit(20000),
      db().from('friendships').select('id', { count: 'exact', head: true })
        .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).eq('status', 'accepted'),
      db().from('user_playlists').select('data').eq('key', `liked-songs-${userId}`).maybeSingle(),
      db().from('time_capsules').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
    ]);

    const byArtist = new Map<string, number>();
    for (const p of (plays ?? []) as { artist: string | null }[]) {
      const a = (p.artist || '').split(/,|&| feat\.?| ft\.?/i)[0].trim();
      if (a) byArtist.set(a, (byArtist.get(a) ?? 0) + 1);
    }
    const badges: Badge[] = [];
    [...byArtist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([artist, n]) => {
      const tier = ARTIST_TIERS.find(([min]) => n >= min);
      if (tier) badges.push({ id: `artist:${artist}`, icon: 'artist', label: `${tier[2]} de ${artist}`, description: `${n} escuchas de ${artist}`, tier: tier[1] });
    });
    const metrics = {
      plays: plays?.length ?? 0,
      artists: byArtist.size,
      friends: friends ?? 0,
      likes: ((liked as any)?.data?.tracks ?? []).length,
      capsules: capsules ?? 0,
    };
    for (const a of ACHIEVEMENTS) {
      const v = metrics[a.metric];
      const level = a.thresholds.filter((t) => v >= t).length;
      if (!level) continue;
      const tier = (['bronze', 'silver', 'gold'] as const)[level - 1];
      badges.push({ id: a.id, icon: a.icon, label: a.label, description: `${v} ${a.unit}`, tier });
    }
    badgeCache.set(userId, { at: Date.now(), badges });
    res.json({ badges });
  } catch (e) {
    console.error('[Badges]', e);
    res.json({ badges: [] });
  }
});

export default router;
