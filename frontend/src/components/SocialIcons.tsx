/** Iconos de trazo (sin emojis) para cápsulas, vídeos, emblemas y envío en vivo. */
type P = { size?: number; className?: string };

const base = (size = 18) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
});

export const IconHourglass = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4" /></svg>
);
export const IconLock = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const IconVideo = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="2" y="5" width="15" height="14" rx="2" /><path d="m17 10 5-3v10l-5-3" /></svg>
);
export const IconPlay = ({ size, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
);
export const IconSend = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>
);
export const IconCheck = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M20 6 9 17l-5-5" /></svg>
);
export const IconClose = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
);
export const IconPlus = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
const IconHeadphones = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></svg>
);
const IconCompass = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z" /></svg>
);
const IconUsers = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
const IconHeart = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" /></svg>
);
const IconMic = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg>
);

/** Icono de un emblema según su clave (la envía el backend en `icon`). */
export function BadgeIcon({ name, size = 14 }: { name: string; size?: number }) {
  switch (name) {
    case 'artist': return <IconMic size={size} />;
    case 'plays': return <IconHeadphones size={size} />;
    case 'explorer': return <IconCompass size={size} />;
    case 'social': return <IconUsers size={size} />;
    case 'likes': return <IconHeart size={size} />;
    case 'capsules': return <IconHourglass size={size} />;
    default: return null;
  }
}

/** Novedades (destellos). */
export const IconSparkles = ({ size, className }: P) => (
  <svg {...base(size)} className={className}><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>
);
