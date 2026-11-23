import { useEffect, useState } from 'react';
/**
 * Novedades de KokoMusic que ve el usuario (página /novedades).
 * Añade cada versión ARRIBA del todo, con un `id` nuevo: el punto de
 * "nuevo" del menú aparece hasta que el usuario abre la página.
 */

export type ChangeKind = 'nuevo' | 'mejora' | 'arreglo';

export interface ChangelogEntry {
  id: string;
  date: string; // AAAA-MM-DD
  title: string;
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-11-23',
    date: '2026-11-23',
    title: 'Cápsulas, canciones en vivo e insignias',
    changes: [
      { kind: 'nuevo', text: 'Cápsula del tiempo: guarda canciones para que te aparezcan a ti o a tus amigos cuando llegue la fecha.' },
      { kind: 'nuevo', text: 'Canción en vivo: envía una canción a un amigo y le aparece al momento con una animación. Se puede desactivar en tu perfil.' },
      { kind: 'nuevo', text: 'Insignias en el perfil: pines de tus artistas más escuchados y de tus logros.' },
      { kind: 'nuevo', text: 'Aviso cuando un amigo sube su B-Music del día.' },
      { kind: 'nuevo', text: 'En la app de Android: guarda el videoclip de una canción en el móvil y míralo en "Mis vídeos", también sin conexión.' },
      { kind: 'mejora', text: 'Las notificaciones de amigos y mensajes llegan como avisos del móvil en la app de Android.' },
      { kind: 'mejora', text: 'Búsquedas más rápidas, sobre todo las de YouTube.' },
      { kind: 'mejora', text: 'Las búsquedas recientes guardan más canciones y ya no muestran el texto que escribiste.' },
      { kind: 'mejora', text: 'Sin conexión, la app de Android abre directamente tus canciones descargadas.' },
      { kind: 'mejora', text: 'Nuevo diseño para enviar canciones a amigos.' },
      { kind: 'arreglo', text: 'Las canciones de "Tus me gusta" ya no desaparecen.' },
      { kind: 'arreglo', text: 'La música sigue sonando en segundo plano aunque la siguiente canción tarde en cargar.' },
      { kind: 'arreglo', text: 'El panel de notificaciones se ve entero en el móvil.' },
      { kind: 'arreglo', text: 'El icono de la app de Android tiene fondo blanco, como el acceso directo.' },
    ],
  },
];

const SEEN_KEY = 'koko_changelog_seen';

export function hasUnseenChangelog(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== CHANGELOG[0]?.id; } catch { return false; }
}

export function markChangelogSeen(): void {
  try { localStorage.setItem(SEEN_KEY, CHANGELOG[0]?.id ?? ''); } catch { /* sin storage */ }
  window.dispatchEvent(new Event('koko-changelog-seen'));
}

/** true mientras haya novedades sin ver; se actualiza al abrir la página. */
export function useUnseenChangelog(): boolean {
  const [unseen, setUnseen] = useState(hasUnseenChangelog);
  useEffect(() => {
    const onSeen = () => setUnseen(hasUnseenChangelog());
    window.addEventListener('koko-changelog-seen', onSeen);
    return () => window.removeEventListener('koko-changelog-seen', onSeen);
  }, []);
  return unseen;
}
