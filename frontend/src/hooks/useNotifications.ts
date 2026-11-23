import { useEffect, useCallback } from 'react';
import { useNotificationStore } from '../store/notificationStore';
import { getNotifications, markNotificationsRead } from '../lib/api';
import { getApiUrl } from '../lib/backendResolver';
import { enqueueSongDrops } from '../components/SongDropOverlay';
import { isInsideAndroidApp, syncAndroidNotificationSource } from '../lib/androidApp';

// 10 s: las canciones "en vivo" de amigos deben aparecer casi al momento
const POLL_INTERVAL = 10 * 1000;

export function useNotifications() {
  const { setNotifications, markAllRead, isOpen } = useNotificationStore();

  const fetchNotifications = useCallback(async () => {
    const userId = localStorage.getItem('koko_device_id') || '';
    if (!userId) return;
    try {
      const data = await getNotifications(userId);
      setNotifications(data.notifications ?? []);
      enqueueSongDrops(data.notifications ?? []);
    } catch {
      // Silently fail — backend may not be running or config is empty
    }
  }, [setNotifications]);

  // APK: la WebView no admite Web Push, así que la app nativa sondea los avisos
  // y los muestra como notificaciones del sistema (SocialNotifier.kt).
  useEffect(() => {
    if (!isInsideAndroidApp()) return;
    const userId = localStorage.getItem('koko_device_id') || '';
    if (userId) {
      getApiUrl().then((base) => {
        const abs = new URL(base, window.location.href).toString().replace(/\/$/, '');
        syncAndroidNotificationSource(abs, userId);
      }).catch(() => {});
    }
    window.__kokoOpenNotifications = () => useNotificationStore.getState().setOpen(true);
    return () => { window.__kokoOpenNotifications = undefined; };
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // When panel opens: immediately re-fetch to get latest, then mark all read
  useEffect(() => {
    if (!isOpen) return;
    const userId = localStorage.getItem('koko_device_id') || '';
    if (!userId) return;
    fetchNotifications().then(() => {
      markAllRead();
      markNotificationsRead(userId).catch(() => {});
    });
  }, [isOpen, fetchNotifications, markAllRead]);
}

