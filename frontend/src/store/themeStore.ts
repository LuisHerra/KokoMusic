import { create } from 'zustand';

export type AccentColorKey = 'green' | 'cyan' | 'magenta' | 'purple' | 'amber' | 'crimson' | 'gold';
export type BgStyleKey = 'dark' | 'glass' | 'ambient' | 'wallpaper';
export type DensityKey = 'comfortable' | 'compact';

export interface AccentColorConfig {
  key: AccentColorKey;
  label: string;
  accent: string;
  bright: string;
  dim: string;
  glow: string;
}

export const ACCENT_COLORS: Record<AccentColorKey, AccentColorConfig> = {
  green: {
    key: 'green',
    label: 'Spotify Green',
    accent: '#1DB954',
    bright: '#1ed760',
    dim: '#158a3e',
    glow: 'rgba(29, 185, 84, 0.35)',
  },
  cyan: {
    key: 'cyan',
    label: 'Electric Cyan',
    accent: '#00F2FE',
    bright: '#4FACFE',
    dim: '#00B4D8',
    glow: 'rgba(0, 242, 254, 0.35)',
  },
  magenta: {
    key: 'magenta',
    label: 'Sunset Magenta',
    accent: '#F107A3',
    bright: '#FF52D9',
    dim: '#7B2CBF',
    glow: 'rgba(241, 7, 163, 0.35)',
  },
  purple: {
    key: 'purple',
    label: 'Cyberpunk Violet',
    accent: '#8A2BE2',
    bright: '#A855F7',
    dim: '#6B21A8',
    glow: 'rgba(138, 43, 226, 0.35)',
  },
  amber: {
    key: 'amber',
    label: 'Solar Amber',
    accent: '#FF9F1C',
    bright: '#FFBF69',
    dim: '#CB997E',
    glow: 'rgba(255, 159, 28, 0.35)',
  },
  crimson: {
    key: 'crimson',
    label: 'Crimson Pulse',
    accent: '#FF0054',
    bright: '#FF5400',
    dim: '#9E0059',
    glow: 'rgba(255, 0, 84, 0.35)',
  },
  gold: {
    key: 'gold',
    label: 'Pure Gold',
    accent: '#FFD700',
    bright: '#FFEE58',
    dim: '#C5A059',
    glow: 'rgba(255, 215, 0, 0.35)',
  },
};

export const PRESET_WALLPAPERS = [
  { id: 'cyberpunk', label: 'Neon City', url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=1200&auto=format&fit=crop&q=80' },
  { id: 'lofi', label: 'Lofi Sunset', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80' },
  { id: 'nebula', label: 'Cosmic Nebula', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1200&auto=format&fit=crop&q=80' },
  { id: 'forest', label: 'Deep Forest', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&auto=format&fit=crop&q=80' },
];

interface ThemeState {
  accentColor: AccentColorKey;
  bgStyle: BgStyleKey;
  wallpaperUrl: string;
  density: DensityKey;
  isThemeModalOpen: boolean;

  setAccentColor: (color: AccentColorKey) => void;
  setBgStyle: (style: BgStyleKey) => void;
  setWallpaperUrl: (url: string) => void;
  setDensity: (density: DensityKey) => void;
  setIsThemeModalOpen: (open: boolean) => void;
  toggleThemeModal: () => void;
  applyThemeToDOM: () => void;
}

const savedAccent = (localStorage.getItem('koko_theme_accent') as AccentColorKey) || 'green';
const savedBgStyle = (localStorage.getItem('koko_theme_bg_style') as BgStyleKey) || 'dark';
const savedWallpaper = localStorage.getItem('koko_theme_wallpaper') || PRESET_WALLPAPERS[0].url;
const savedDensity = (localStorage.getItem('koko_theme_density') as DensityKey) || 'comfortable';

export const useThemeStore = create<ThemeState>((set, get) => ({
  accentColor: savedAccent,
  bgStyle: savedBgStyle,
  wallpaperUrl: savedWallpaper,
  density: savedDensity,
  isThemeModalOpen: false,

  setAccentColor: (color) => {
    localStorage.setItem('koko_theme_accent', color);
    set({ accentColor: color });
    get().applyThemeToDOM();
  },

  setBgStyle: (style) => {
    localStorage.setItem('koko_theme_bg_style', style);
    set({ bgStyle: style });
    get().applyThemeToDOM();
  },

  setWallpaperUrl: (url) => {
    localStorage.setItem('koko_theme_wallpaper', url);
    set({ wallpaperUrl: url });
    get().applyThemeToDOM();
  },

  setDensity: (density) => {
    localStorage.setItem('koko_theme_density', density);
    set({ density });
    get().applyThemeToDOM();
  },

  setIsThemeModalOpen: (open) => set({ isThemeModalOpen: open }),
  toggleThemeModal: () => set((s) => ({ isThemeModalOpen: !s.isThemeModalOpen })),

  applyThemeToDOM: () => {
    const { accentColor, bgStyle, wallpaperUrl, density } = get();
    const cfg = ACCENT_COLORS[accentColor] || ACCENT_COLORS.green;
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty('--accent', cfg.accent);
    root.style.setProperty('--accent-bright', cfg.bright);
    root.style.setProperty('--accent-dim', cfg.dim);
    root.style.setProperty('--accent-glow', cfg.glow);

    // Apply layout density
    if (density === 'compact') {
      root.classList.add('compact-density');
      body.classList.add('compact-density');
    } else {
      root.classList.remove('compact-density');
      body.classList.remove('compact-density');
    }

    // Apply background styles
    root.setAttribute('data-bg-style', bgStyle);
    body.setAttribute('data-bg-style', bgStyle);
    body.style.backgroundImage = '';

    if (bgStyle === 'wallpaper' && wallpaperUrl) {
      body.style.backgroundImage = `linear-gradient(to bottom, rgba(10, 10, 10, 0.70), rgba(10, 10, 10, 0.90)), url(${wallpaperUrl})`;
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';
    } else if (bgStyle === 'glass') {
      body.style.backgroundImage = `radial-gradient(circle at 50% 20%, ${cfg.glow} 0%, rgba(18, 18, 18, 0.95) 70%)`;
      body.style.backgroundAttachment = 'fixed';
    } else if (bgStyle === 'ambient') {
      body.style.backgroundImage = `radial-gradient(circle at 80% 0%, ${cfg.glow} 0%, rgba(10, 10, 10, 0.98) 50%)`;
      body.style.backgroundAttachment = 'fixed';
    }
  },
}));
