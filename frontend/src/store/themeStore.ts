import { create } from 'zustand';

export type AccentColorKey = 'green' | 'cyan' | 'magenta' | 'purple' | 'amber' | 'crimson' | 'gold' | 'custom';
export type BgStyleKey = 'dark' | 'glass' | 'ambient' | 'wallpaper' | 'custom';
export type DensityKey = 'comfortable' | 'compact';
export type FontStyleKey = 'dmsans' | 'outfit' | 'inter';
export type CornerRadiusKey = 'sharp' | 'rounded' | 'soft';
export type CardStyleKey = 'dark' | 'glass' | 'tinted' | 'outline';
export type CardHoverKey = 'lift' | 'glow' | 'neon';

export interface AccentColorConfig {
  key: AccentColorKey;
  label: string;
  accent: string;
  bright: string;
  dim: string;
  glow: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return `rgba(29, 185, 84, ${alpha})`;
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function adjustBrightness(hex: string, percent: number): string {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return hex;
  const num = parseInt(cleanHex, 16);
  let r = (num >> 16) + percent;
  if (r > 255) r = 255; else if (r < 0) r = 0;
  let b = ((num >> 8) & 0x00FF) + percent;
  if (b > 255) b = 255; else if (b < 0) b = 0;
  let g = (num & 0x0000FF) + percent;
  if (g > 255) g = 255; else if (g < 0) g = 0;
  return '#' + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}

export const ACCENT_COLORS: Record<string, AccentColorConfig> = {
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
    label: 'Royal Gold',
    accent: '#FFD700',
    bright: '#FFE566',
    dim: '#B8860B',
    glow: 'rgba(255, 215, 0, 0.35)',
  },
};

export const PRESET_WALLPAPERS = [
  { id: 'neon-city', label: 'Neon City', url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1200&auto=format&fit=crop&q=80' },
  { id: 'abstract-wave', label: 'Cosmic Wave', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop&q=80' },
  { id: 'dark-aurora', label: 'Dark Aurora', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&auto=format&fit=crop&q=80' },
  { id: 'forest', label: 'Deep Forest', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1200&auto=format&fit=crop&q=80' },
];

export interface ThemeState {
  accentColor: AccentColorKey;
  customAccentHex: string;
  bgStyle: BgStyleKey;
  customBgHex: string;
  wallpaperUrl: string;
  wallpaperBlur: number;
  density: DensityKey;
  fontStyle: FontStyleKey;
  cornerRadius: CornerRadiusKey;
  cardStyle: CardStyleKey;
  cardHover: CardHoverKey;
  playerOpacity: number;
  customGreeting: string;
  isThemeModalOpen: boolean;

  setAccentColor: (color: AccentColorKey) => void;
  setCustomAccentHex: (hex: string) => void;
  setBgStyle: (style: BgStyleKey) => void;
  setCustomBgHex: (hex: string) => void;
  setWallpaperUrl: (url: string) => void;
  setWallpaperBlur: (blur: number) => void;
  setDensity: (density: DensityKey) => void;
  setFontStyle: (font: FontStyleKey) => void;
  setCornerRadius: (radius: CornerRadiusKey) => void;
  setCardStyle: (style: CardStyleKey) => void;
  setCardHover: (hover: CardHoverKey) => void;
  setPlayerOpacity: (opacity: number) => void;
  setCustomGreeting: (greeting: string) => void;
  setIsThemeModalOpen: (open: boolean) => void;
  toggleThemeModal: () => void;
  applyThemeToDOM: () => void;
}

const savedAccent = (localStorage.getItem('koko_theme_accent') as AccentColorKey) || 'green';
const savedCustomAccentHex = localStorage.getItem('koko_theme_custom_accent_hex') || '#00F2FE';
const savedBgStyle = (localStorage.getItem('koko_theme_bg_style') as BgStyleKey) || 'dark';
const savedCustomBgHex = localStorage.getItem('koko_theme_custom_bg_hex') || '#0F172A';
const savedWallpaper = localStorage.getItem('koko_theme_wallpaper') || PRESET_WALLPAPERS[0].url;
const savedWallpaperBlur = parseInt(localStorage.getItem('koko_theme_wallpaper_blur') || '12', 10);
const savedDensity = (localStorage.getItem('koko_theme_density') as DensityKey) || 'comfortable';
const savedFontStyle = (localStorage.getItem('koko_theme_font_style') as FontStyleKey) || 'dmsans';
const savedCornerRadius = (localStorage.getItem('koko_theme_corner_radius') as CornerRadiusKey) || 'rounded';
const savedCardStyle = (localStorage.getItem('koko_theme_card_style') as CardStyleKey) || 'glass';
const savedCardHover = (localStorage.getItem('koko_theme_card_hover') as CardHoverKey) || 'glow';
const savedPlayerOpacity = parseFloat(localStorage.getItem('koko_theme_player_opacity') || '0.85');
const savedGreeting = localStorage.getItem('koko_theme_custom_greeting') || '';

export const useThemeStore = create<ThemeState>((set, get) => ({
  accentColor: savedAccent,
  customAccentHex: savedCustomAccentHex,
  bgStyle: savedBgStyle,
  customBgHex: savedCustomBgHex,
  wallpaperUrl: savedWallpaper,
  wallpaperBlur: savedWallpaperBlur,
  density: savedDensity,
  fontStyle: savedFontStyle,
  cornerRadius: savedCornerRadius,
  cardStyle: savedCardStyle,
  cardHover: savedCardHover,
  playerOpacity: savedPlayerOpacity,
  customGreeting: savedGreeting,
  isThemeModalOpen: false,

  setAccentColor: (color) => {
    localStorage.setItem('koko_theme_accent', color);
    set({ accentColor: color });
    get().applyThemeToDOM();
  },

  setCustomAccentHex: (hex) => {
    localStorage.setItem('koko_theme_custom_accent_hex', hex);
    localStorage.setItem('koko_theme_accent', 'custom');
    set({ customAccentHex: hex, accentColor: 'custom' });
    get().applyThemeToDOM();
  },

  setBgStyle: (style) => {
    localStorage.setItem('koko_theme_bg_style', style);
    set({ bgStyle: style });
    get().applyThemeToDOM();
  },

  setCustomBgHex: (hex) => {
    localStorage.setItem('koko_theme_custom_bg_hex', hex);
    localStorage.setItem('koko_theme_bg_style', 'custom');
    set({ customBgHex: hex, bgStyle: 'custom' });
    get().applyThemeToDOM();
  },

  setWallpaperUrl: (url) => {
    localStorage.setItem('koko_theme_wallpaper', url);
    set({ wallpaperUrl: url });
    get().applyThemeToDOM();
  },

  setWallpaperBlur: (blur) => {
    localStorage.setItem('koko_theme_wallpaper_blur', blur.toString());
    set({ wallpaperBlur: blur });
    get().applyThemeToDOM();
  },

  setDensity: (density) => {
    localStorage.setItem('koko_theme_density', density);
    set({ density });
    get().applyThemeToDOM();
  },

  setFontStyle: (font) => {
    localStorage.setItem('koko_theme_font_style', font);
    set({ fontStyle: font });
    get().applyThemeToDOM();
  },

  setCornerRadius: (radius) => {
    localStorage.setItem('koko_theme_corner_radius', radius);
    set({ cornerRadius: radius });
    get().applyThemeToDOM();
  },

  setCardStyle: (style) => {
    localStorage.setItem('koko_theme_card_style', style);
    set({ cardStyle: style });
    get().applyThemeToDOM();
  },

  setCardHover: (hover) => {
    localStorage.setItem('koko_theme_card_hover', hover);
    set({ cardHover: hover });
    get().applyThemeToDOM();
  },

  setPlayerOpacity: (opacity) => {
    localStorage.setItem('koko_theme_player_opacity', opacity.toString());
    set({ playerOpacity: opacity });
    get().applyThemeToDOM();
  },

  setCustomGreeting: (greeting) => {
    localStorage.setItem('koko_theme_custom_greeting', greeting);
    set({ customGreeting: greeting });
  },

  setIsThemeModalOpen: (open) => set({ isThemeModalOpen: open }),
  toggleThemeModal: () => set((s) => ({ isThemeModalOpen: !s.isThemeModalOpen })),

  applyThemeToDOM: () => {
    const { accentColor, customAccentHex, bgStyle, customBgHex, wallpaperUrl, wallpaperBlur, density, fontStyle, cornerRadius, cardStyle, cardHover, playerOpacity } = get();

    let cfg: AccentColorConfig;
    if (accentColor === 'custom') {
      const accent = customAccentHex || '#00F2FE';
      cfg = {
        key: 'custom',
        label: 'Personalizado',
        accent: accent,
        bright: adjustBrightness(accent, 25),
        dim: adjustBrightness(accent, -35),
        glow: hexToRgba(accent, 0.38),
      };
    } else {
      cfg = ACCENT_COLORS[accentColor] || ACCENT_COLORS.green;
    }

    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty('--accent', cfg.accent);
    root.style.setProperty('--accent-bright', cfg.bright);
    root.style.setProperty('--accent-dim', cfg.dim);
    root.style.setProperty('--accent-glow', cfg.glow);
    root.style.setProperty('--wallpaper-blur', `${wallpaperBlur}px`);

    // Dynamically update PWA / Direct Access Mobile Status Bar Theme Color
    try {
      let themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', cfg.accent);
      } else {
        themeColorMeta = document.createElement('meta');
        themeColorMeta.setAttribute('name', 'theme-color');
        themeColorMeta.setAttribute('content', cfg.accent);
        document.head.appendChild(themeColorMeta);
      }

      let appleMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (appleMeta) {
        appleMeta.setAttribute('content', 'black-translucent');
      }
    } catch (e) {
      /* ignore SSR or browser error */
    }

    // Apply layout density
    if (density === 'compact') {
      root.classList.add('compact-density');
      body.classList.add('compact-density');
    } else {
      root.classList.remove('compact-density');
      body.classList.remove('compact-density');
    }

    // Apply corner radius
    if (cornerRadius === 'sharp') {
      root.style.setProperty('--radius-sm', '2px');
      root.style.setProperty('--radius-md', '4px');
      root.style.setProperty('--radius-lg', '6px');
    } else if (cornerRadius === 'soft') {
      root.style.setProperty('--radius-sm', '8px');
      root.style.setProperty('--radius-md', '16px');
      root.style.setProperty('--radius-lg', '24px');
    } else {
      root.style.setProperty('--radius-sm', '4px');
      root.style.setProperty('--radius-md', '8px');
      root.style.setProperty('--radius-lg', '12px');
    }

    // Apply font family
    if (fontStyle === 'outfit') {
      root.style.fontFamily = "'Outfit', 'DM Sans', sans-serif";
      body.style.fontFamily = "'Outfit', 'DM Sans', sans-serif";
    } else if (fontStyle === 'inter') {
      root.style.fontFamily = "'Inter', 'DM Sans', sans-serif";
      body.style.fontFamily = "'Inter', 'DM Sans', sans-serif";
    } else {
      root.style.fontFamily = "'DM Sans', -apple-system, sans-serif";
      body.style.fontFamily = "'DM Sans', -apple-system, sans-serif";
    }

    // Apply card style & hover attributes
    root.setAttribute('data-card-style', cardStyle);
    body.setAttribute('data-card-style', cardStyle);
    root.setAttribute('data-card-hover', cardHover);
    body.setAttribute('data-card-hover', cardHover);

    // Apply player opacity
    root.style.setProperty('--player-opacity', playerOpacity.toString());

    // Apply background styles & variables
    root.setAttribute('data-bg-style', bgStyle);
    body.setAttribute('data-bg-style', bgStyle);
    
    const appRoot = document.getElementById('root');
    if (appRoot) appRoot.setAttribute('data-bg-style', bgStyle);

    body.style.backgroundImage = '';
    body.style.backgroundColor = '';

    if (bgStyle === 'wallpaper' && wallpaperUrl) {
      root.style.setProperty('--bg-base', 'transparent');
      root.style.setProperty('--bg-elevated', 'rgba(18, 18, 20, 0.65)');
      const darkAlphaTop = wallpaperBlur === 0 ? 0.25 : 0.65;
      const darkAlphaBottom = wallpaperBlur === 0 ? 0.45 : 0.85;
      body.style.backgroundImage = `linear-gradient(to bottom, rgba(10, 10, 10, ${darkAlphaTop}), rgba(10, 10, 10, ${darkAlphaBottom})), url(${wallpaperUrl})`;
      body.style.backgroundSize = 'cover';
      body.style.backgroundPosition = 'center';
      body.style.backgroundAttachment = 'fixed';
    } else if (bgStyle === 'glass') {
      root.style.setProperty('--bg-base', 'transparent');
      root.style.setProperty('--bg-elevated', 'rgba(255, 255, 255, 0.05)');
      body.style.backgroundImage = `radial-gradient(circle at 50% 20%, ${cfg.glow} 0%, rgba(14, 14, 16, 0.98) 70%)`;
      body.style.backgroundAttachment = 'fixed';
    } else if (bgStyle === 'ambient') {
      root.style.setProperty('--bg-base', 'transparent');
      root.style.setProperty('--bg-elevated', 'rgba(255, 255, 255, 0.05)');
      body.style.backgroundImage = `radial-gradient(circle at 80% 0%, ${cfg.glow} 0%, rgba(10, 10, 12, 0.98) 55%)`;
      body.style.backgroundAttachment = 'fixed';
    } else if (bgStyle === 'custom' && customBgHex) {
      root.style.setProperty('--bg-base', customBgHex);
      root.style.setProperty('--bg-elevated', adjustBrightness(customBgHex, 15));
      body.style.backgroundColor = customBgHex;
      body.style.backgroundImage = `linear-gradient(to bottom, ${customBgHex}, ${adjustBrightness(customBgHex, -40)})`;
      body.style.backgroundAttachment = 'fixed';
    } else {
      root.style.setProperty('--bg-base', '#0a0a0a');
      root.style.setProperty('--bg-elevated', '#121212');
      body.style.backgroundColor = '#0a0a0a';
    }
  },
}));
