/**
 * Iconos SVG de interfaz (trazo 2px, currentColor) — sustituyen a los emojis
 * para que todo se vea igual en cualquier sistema y respete el color de acento.
 */
import type { SfxId } from '../../lib/djSfx';

type P = { size?: number; className?: string };
const S = ({ size = 18, className, children }: P & { children: React.ReactNode }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const IconX = (p: P) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>;
export const IconArrowRight = (p: P) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>;
export const IconPlay = ({ size = 16, className }: P) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
);
export const IconStop = ({ size = 16, className }: P) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
export const IconTrash = (p: P) => <S {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></S>;
export const IconUsers = (p: P) => <S {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></S>;
export const IconSliders = (p: P) => <S {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></S>;
export const IconClock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const IconCrossfade = (p: P) => <S {...p}><path d="M3 18c6 0 6-12 18-12M3 6c6 0 6 12 18 12" /></S>;
export const IconSpark = (p: P) => <S {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></S>;
export const IconWand = (p: P) => <S {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" /></S>;
export const IconVolume = (p: P) => <S {...p}><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></S>;
export const IconVolumeDown = (p: P) => <S {...p}><path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7" /></S>;
export const IconHeadphones = (p: P) => <S {...p}><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></S>;
export const IconCassette = (p: P) => <S {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><circle cx="16" cy="11" r="2" /><path d="M10 11h4M6 19l2-4h8l2 4" /></S>;
export const IconMusicNote = (p: P) => <S {...p}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></S>;
export const IconFlameSmall = ({ size = 14, className }: P) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2c1.2 4.2 6.6 7.2 6.6 15a6.6 6.6 0 0 1-13.2 0c0-3.6 1.8-5.4 3-7.2 0 2.4 1.2 3.6 2.4 3.6-.6-4.2 0-7.8 1.2-11.4z" />
  </svg>
);
export const IconDot = ({ size = 8, className }: P) => (
  <svg className={className} width={size} height={size} viewBox="0 0 8 8" aria-hidden><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
);

/** Iconos de los efectos de sonido de transición. */
export function SfxIcon({ id, size = 22 }: { id: SfxId; size?: number }) {
  switch (id) {
    case 'riser': return <S size={size}><path d="M3 20c4 0 7-2 9-6s5-9 9-11" /><path d="M16 3h5v5" /></S>;
    case 'downlifter': return <S size={size}><path d="M3 4c4 0 7 2 9 6s5 9 9 11" /><path d="M21 16v5h-5" /></S>;
    case 'boom': return <S size={size}><path d="M12 2l2 6 6-2-4 5 5 4-6 1 1 6-4-4-4 4 1-6-6-1 5-4-4-5 6 2z" /></S>;
    case 'airhorn': return <S size={size}><path d="M3 10v4h3l9 5V5L6 10H3z" /><path d="M18 9a4 4 0 0 1 0 6" /></S>;
    case 'scratch': return <S size={size}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /><path d="M16 5l3-2M5 18l-2 2" /></S>;
    case 'reverse': return <S size={size}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></S>;
    case 'laser': return <S size={size}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></S>;
    case 'sweep': return <S size={size}><path d="M2 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 13c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 18c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2" /></S>;
  }
}
