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
    // id distinto al publicado a mediodía para que vuelva a salir el aviso
    id: '2026-11-24-b',
    date: '2026-11-24',
    title: 'Me gusta a salvo y vídeos que sí se descargan',
    changes: [
      { kind: 'nuevo', text: 'Opción "Descargar vídeo" en el menú de tres puntos de cada canción y en la descarga del reproductor (app de Android).' },
      { kind: 'nuevo', text: 'Botón para descargar la app de Android en tu Perfil y aquí en Novedades.' },
      { kind: 'mejora', text: '"Mis vídeos" está ahora dentro de tu Biblioteca, junto a las canciones descargadas, y muestra el progreso de los vídeos que se están descargando.' },
      { kind: 'arreglo', text: 'Los vídeos guardados ya se reproducen en "Mis vídeos". Si alguno no se pudiera ver ahí, puedes abrirlo con el reproductor de vídeo del móvil.' },
      { kind: 'mejora', text: '"Tus me gusta" ya no se puede convertir en playlist colaborativa, para que tus likes estén siempre en un solo sitio.' },
      { kind: 'arreglo', text: 'Tus "Me gusta", playlists y amigos podían aparecer vacíos de repente, y a veces fallaba añadir amigos. Ya no pasa, y no se había perdido nada.' },
      { kind: 'arreglo', text: 'Descargar el videoclip de una canción ya funciona: ahora lo descarga directamente tu móvil. Necesitas la última versión de la app de Android.' },
    ],
  },
  {
    id: '2026-11-23-3',
    date: '2026-11-23',
    title: 'Gestos en el reproductor y atajo de voz',
    changes: [
      { kind: 'nuevo', text: 'En el móvil, desliza sobre la barra del reproductor desde cualquier sección (o sobre la portada con el reproductor abierto) para ir a otro momento de la canción. Con un deslizamiento largo o rápido pasas a la siguiente o vuelves a la anterior.' },
      { kind: 'nuevo', text: 'En la app de Android, pulsa rápido volumen arriba, abajo y arriba (o abajo, arriba y abajo) para hablar con KokoMusic; el volumen no cambia. Con la app en segundo plano y música sonando aparece un aviso "Toca para hablar".' },
      { kind: 'mejora', text: 'Para guardar un videoclip en el móvil, toca descargar en el reproductor y elige "Vídeo en mi dispositivo". Los encontrarás en "Mis vídeos", dentro de tu Biblioteca. El atajo de voz y los vídeos necesitan la última versión de la app de Android.' },
    ],
  },
  {
    id: '2026-11-23-2',
    date: '2026-11-23',
    title: 'B-Music sin interrupciones y Amigos más rápido',
    changes: [
      { kind: 'nuevo', text: 'Sección de Novedades con un contador cuando hay una versión que aún no has visto.' },
      { kind: 'nuevo', text: 'La Cápsula del tiempo llega al móvil, en el menú "Más", con un diseño hecho a partir de las portadas de sus canciones.' },
      { kind: 'mejora', text: 'Escuchar el B-Music de un amigo ya no cambia la canción que tenías puesta: solo la pausa, y al volver a darle al play sigue donde estaba.' },
      { kind: 'mejora', text: 'La sección de Amigos carga mucho más rápido.' },
      { kind: 'mejora', text: 'Las insignias del perfil son ahora pines con la foto de tus artistas y un borde de bronce, plata u oro.' },
      { kind: 'mejora', text: 'La app arranca más rápido.' },
      { kind: 'arreglo', text: 'Las canciones que no estaban guardadas en KokoMusic a veces no llegaban a sonar; ahora cargan sin esperas.' },
    ],
  },
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

/** Versiones publicadas que el usuario aún no ha visto (0 si está al día). */
export function unseenChangelogCount(): number {
  try {
    const seen = localStorage.getItem(SEEN_KEY);
    const idx = CHANGELOG.findIndex((e) => e.id === seen);
    // Nunca vista: solo cuenta la última versión, no todo el histórico
    return idx === -1 ? (CHANGELOG.length ? 1 : 0) : idx;
  } catch { return 0; }
}

/** Número de versiones sin ver; se actualiza al abrir la página. */
export function useUnseenChangelog(): number {
  const [unseen, setUnseen] = useState(unseenChangelogCount);
  useEffect(() => {
    const onSeen = () => setUnseen(unseenChangelogCount());
    window.addEventListener('koko-changelog-seen', onSeen);
    return () => window.removeEventListener('koko-changelog-seen', onSeen);
  }, []);
  return unseen;
}
