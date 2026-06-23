/**
 * Notification Store — KokoMusic 4b
 * Zustand store for in-app notifications (new releases from followed artists).
 */

import { create } from 'zustand';

export interface AppNotification {
  id: string;
  type: string;
  artistId?: number;
  artistName?: string;
  message: string;
  trackName?: string;
  coverUrl?: string;
  isRead: boolean;
  createdAt: string;
  playlistCode?: string;
  senderName?: string;
  status?: string;
  userId?: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isOpen: boolean;

  setNotifications: (n: AppNotification[]) => void;
  markAllRead: () => void;
  toggleOpen: () => void;
  setOpen: (v: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isOpen: false,

  setNotifications: (notifications) =>
    set({
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
    }),

  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    })),

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (v) => set({ isOpen: v }),
}));
