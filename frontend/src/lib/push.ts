import { apiFetch } from './api';

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'default' | 'subscribed' | 'granted';

const urlBase64ToUint8Array = (b64: string) => {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function getRegistration() {
  return navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await getRegistration().catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'subscribed';
  return Notification.permission === 'granted' ? 'granted' : 'default';
}

/** Pide permiso (debe llamarse desde un gesto del usuario) y registra la suscripción en el backend. */
export async function enablePush(userId: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  return syncPushSubscription(userId);
}

/** Crea/renueva la suscripción y la guarda en el backend. Sin pedir permiso. */
export async function syncPushSubscription(userId: string): Promise<PushState> {
  if (!pushSupported() || Notification.permission !== 'granted' || !userId) return getPushState();
  const { enabled, publicKey } = await apiFetch<{ enabled: boolean; publicKey: string }>('/push/public-key');
  if (!enabled) return 'unavailable';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await apiFetch('/push/subscribe', { method: 'POST', body: JSON.stringify({ userId, subscription: sub.toJSON() }) });
  return 'subscribed';
}

export async function disablePush(): Promise<PushState> {
  const reg = await getRegistration().catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiFetch('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  return getPushState();
}
