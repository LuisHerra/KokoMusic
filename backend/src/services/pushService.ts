/**
 * Push Service — Web Push (VAPID) para avisar a los usuarios con la app cerrada.
 * Suscripciones en `kokomusic.push_subscriptions` (ver add_push_subscriptions.sql).
 * Si faltan las claves VAPID el envío se desactiva en silencio.
 */

import webpush from 'web-push';
import { supabase } from './supabaseService';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@kokomusic.app';

export const pushEnabled = !!(PUBLIC_KEY && PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
} else {
  console.warn('[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no configuradas — push desactivado');
}

export const getPublicKey = () => PUBLIC_KEY;

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  /** Ruta dentro de la app a abrir al tocar la notificación, p. ej. "friends" */
  url?: string;
  tag?: string;
}

export async function saveSubscription(userId: string, sub: any, userAgent?: string): Promise<string | null> {
  if (!supabase) return 'Supabase no configurado';
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return 'Suscripción inválida';
  const { error } = await supabase
    .schema('kokomusic')
    .from('push_subscriptions')
    .upsert(
      { endpoint: sub.endpoint, user_id: userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent ?? null },
      { onConflict: 'endpoint' }
    );
  return error ? error.message : null;
}

export async function removeSubscription(endpoint: string): Promise<void> {
  if (!supabase) return;
  await supabase.schema('kokomusic').from('push_subscriptions').delete().eq('endpoint', endpoint);
}

/** Envía un push a todos los dispositivos de los usuarios dados. Nunca lanza. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushEnabled || !supabase || userIds.length === 0) return;
  try {
    const { data: subs, error } = await supabase
      .schema('kokomusic')
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (error || !subs?.length) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s: any) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        } catch (e: any) {
          // 404/410 = suscripción caducada o revocada
          if (e?.statusCode === 404 || e?.statusCode === 410) await removeSubscription(s.endpoint);
          else console.error('[Push] Error enviando:', e?.statusCode, e?.body || e?.message);
        }
      })
    );
  } catch (e) {
    console.error('[Push] sendPushToUsers falló:', e);
  }
}

export const sendPushToUser = (userId: string, payload: PushPayload) => sendPushToUsers([userId], payload);
