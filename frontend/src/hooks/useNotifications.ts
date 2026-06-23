import { useEffect, useCallback } from 'react';
import { useNotificationStore } from '../store/notificationStore';
import { getNotifications, markNotificationsRead } from '../lib/api';

const POLL_INTERVAL = 30 * 1000;

export function useNotifications() {
  const { setNotifications, markAllRead, isOpen } = useNotificationStore();

  const fetchNotifications = useCallback(async () => {
    const userId = localStorage.getItem('koko_device_id') || '';
    if (!userId) return;
    try {
      const data = await getNotifications(userId);
      setNotifications(data.notifications ?? []);
    } catch {
      // Silently fail — backend may not be running or config is empty
    }
  }, [setNotifications]);

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

