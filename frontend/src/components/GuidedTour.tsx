import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Guías contextuales: cada pantalla se explica a sí misma la primera vez que
 * se abre (Modo DJ al entrar en Modo DJ, Sinfonía al abrir Sinfonía…), con
 * pocos pasos, en vez de un recorrido enorme nada más entrar.
 *
 * - Las pantallas llaman a useScreenTour('id') al montarse/abrirse.
 * - Solo se muestran si las guías están activadas (cuentas nuevas, o desde
 *   Perfil → "Ver guías de nuevo") y esa pantalla no se ha visto antes.
 * - Una sola guía a la vez; si se piden varias seguidas, van en cola.
 * - Espera a que no haya ningún modal marcado con data-blocks-tour (p.ej. el
 *   de gustos iniciales) para no pisarlo.
 * - Los elementos se marcan con data-tour="…". Cada paso prueba sus
 *   selectores en orden: si el primero está oculto (móvil), usa el siguiente
 *   y muestra `fallbackNote`; los pasos `optional` sin elemento se omiten.
 */

const ENABLED_KEY = 'koko_tours_enabled';
const SEEN_PREFIX = 'koko_tour_seen_';
const REQUEST_EVENT = 'koko-request-tour';

export type TourId =
  | 'home' | 'player' | 'mobile-player' | 'lyrics' | 'sinfonia' | 'sinfonia-session'
  | 'devices' | 'dj' | 'karaoke' | 'stats' | 'friends' | 'profile' | 'artist-studio';

interface TourStep {
  title: string;
  body: string;
  targets?: string[];
  optional?: boolean;
  fallbackNote?: string;
}

const TOURS: Record<TourId, TourStep[]> = {
  home: [
    {
      title: '¡Bienvenido a KokoMusic! 🎵',
      body: 'No te vamos a soltar todo de golpe: cada sección te enseñará sus funciones la primera vez que entres en ella. Aquí, solo lo básico.',
    },
    {
      title: 'Todas las secciones',
      body: 'Además de Inicio, Buscar y tu Biblioteca, tienes Estadísticas, Amigos, Modo DJ y Estudio Karaoke. Entra en cualquiera y te la explicamos.',
      targets: ['[data-tour="nav"]', '[data-tour="more"]'],
      fallbackNote: 'En el móvil, las secciones extra están en «Más».',
    },
    {
      title: 'Empieza a escuchar',
      body: 'Busca una canción, un artista o un álbum y dale al play. Cuando suene algo, te enseñamos lo que puede hacer el reproductor.',
      targets: ['[data-tour="search"]'],
      optional: true,
    },
    {
      title: 'Hazla tuya',
      body: 'Aquí cambias el color de acento, el fondo y el estilo de toda la app.',
      targets: ['[data-tour="theme"]'],
      optional: true,
    },
  ],

  player: [
    {
      title: 'Letras inmersivas',
      body: 'Letras sincronizadas a pantalla completa, con traducción, efectos y modo karaoke.',
      targets: ['[data-tour="lyrics"]'],
    },
    {
      title: 'Sinfonía',
      body: 'Escucha en grupo: tus amigos oyen lo mismo que tú a la vez y votáis la cola entre todos.',
      targets: ['[data-tour="sinfonia"]'],
    },
    {
      title: 'Dispositivos',
      body: 'Como Spotify Connect: controla desde aquí lo que suena en tu móvil (o al revés).',
      targets: ['[data-tour="devices"]'],
    },
    {
      title: 'Ecualizador',
      body: 'Ajusta graves, medios y agudos con 5 bandas y presets.',
      targets: ['[data-tour="eq"]'],
      optional: true,
    },
  ],

  'mobile-player': [
    {
      title: 'Tu reproductor',
      body: 'Desliza hacia abajo para cerrarlo. Estas son las funciones extra:',
    },
    {
      title: 'Letras',
      body: 'Letras sincronizadas a pantalla completa, con traducción y modo karaoke.',
      targets: ['[data-tour="mfp-lyrics"]'],
    },
    {
      title: 'Vídeo',
      body: 'Pon el videoclip de fondo en lugar de la portada. En Perfil puedes hacer que salga siempre por defecto.',
      targets: ['[data-tour="mfp-video"]'],
    },
    {
      title: 'Sinfonía',
      body: 'Escucha en grupo con tus amigos: todos oyen lo mismo a la vez.',
      targets: ['[data-tour="mfp-sinfonia"]'],
    },
    {
      title: 'Dispositivos',
      body: 'Controla desde el móvil lo que suena en tu ordenador, o al revés, como Spotify Connect.',
      targets: ['[data-tour="mfp-devices"]'],
    },
  ],

  lyrics: [
    {
      title: 'Letras sincronizadas',
      body: 'La línea que suena se ilumina. Toca cualquier línea para saltar a ese momento de la canción.',
      targets: ['[data-tour="lyrics-lines"]'],
    },
    {
      title: 'A tu gusto',
      body: 'Tamaño, tipografía, alineación, efecto de animación, colores y traducción a otro idioma.',
      targets: ['[data-tour="lyrics-settings"]'],
    },
    {
      title: 'Modo karaoke',
      body: 'La línea se va iluminando palabra a palabra, para cantarla a tiempo.',
      targets: ['[data-tour="lyrics-karaoke"]'],
    },
    {
      title: 'Partes de la canción',
      body: 'Salta directamente a la intro, a un verso o al estribillo.',
      targets: ['[data-tour="lyrics-sections"]'],
      optional: true,
    },
  ],

  sinfonia: [
    {
      title: 'Sinfonía',
      body: 'Escucha música con tus amigos a la vez: el anfitrión elige y todos oyen lo mismo, cada uno desde su dispositivo.',
    },
    {
      title: 'Crear una sala',
      body: 'Te damos un código de 4 letras y un QR para que tus amigos se unan.',
      targets: ['[data-tour="jam-start"]'],
    },
    {
      title: 'Unirte a una sala',
      body: '¿Un amigo ya tiene una? Escribe aquí su código.',
      targets: ['[data-tour="jam-join"]'],
    },
  ],

  'sinfonia-session': [
    {
      title: 'Invita con el código',
      body: 'Comparte el código, el QR o el enlace para que se unan.',
      targets: ['[data-tour="jam-code"]'],
    },
    {
      title: 'Escucha sincronizada',
      body: 'Actívala para que suene aquí al mismo tiempo que en el anfitrión. Desactívala si ya lo oyes por su altavoz.',
      targets: ['[data-tour="jam-sync"]'],
    },
    {
      title: 'Cola colaborativa',
      body: 'Todos pueden añadir canciones y votar cuáles suenan antes.',
      targets: ['[data-tour="jam-queue-tab"]'],
    },
  ],

  devices: [
    {
      title: 'Tus dispositivos',
      body: 'Aquí aparecen tus otros dispositivos con KokoMusic abierto. Toca uno para conectarte: lo controlas desde aquí y la música suena allí.',
      targets: ['[data-tour="devices-list"]'],
    },
    {
      title: 'Traer la música aquí',
      body: 'Ya conectado, «Escuchar aquí» pasa la música a este dispositivo en el mismo punto, y «Desconectar» suelta la conexión.',
    },
  ],

  dj: [
    {
      title: 'Tus dos decks',
      body: 'A la izquierda lo que suena ahora; a la derecha, lo siguiente de la cola (puedes elegir otra canción).',
      targets: ['[data-tour="dj-decks"]'],
    },
    {
      title: 'Hot cues',
      body: 'Marca hasta 4 puntos de la canción y salta a ellos al instante.',
      targets: ['[data-tour="dj-cues"]'],
      optional: true,
    },
    {
      title: 'Transiciones',
      body: 'Decide cómo pasa de una canción a la otra: dónde sale, dónde entra y la curva del crossfade. Se guarda para esa pareja y se aplica sola.',
      targets: ['[data-tour="dj-transition"]'],
      optional: true,
    },
    {
      title: 'Efectos en vivo',
      body: 'Slowed, reverb/eco y barrido de filtro sobre lo que está sonando.',
      targets: ['[data-tour="dj-fx"]'],
      optional: true,
    },
  ],

  karaoke: [
    {
      title: 'Letra en grande',
      body: 'La letra va sincronizada con la canción, como un teleprompter.',
      targets: ['[data-tour="karaoke-lyrics"]', '[data-tour="karaoke-tabs"]'],
      fallbackNote: 'En el móvil, cambia entre letra, notas, tomas y efectos con estas pestañas.',
    },
    {
      title: 'Graba tu voz',
      body: 'Canta encima de la canción y guarda la toma para escucharla después.',
      targets: ['[data-tour="karaoke-record"]'],
      optional: true,
    },
    {
      title: 'Auto-Tune y efectos',
      body: 'Elige la escala, cuánta corrección de tono quieres, la reverb y el volumen de tu voz frente a la música.',
      targets: ['[data-tour="karaoke-fx"]', '[data-tour="karaoke-tabs"]'],
      fallbackNote: 'En el móvil están en la pestaña «Efectos / Tono».',
    },
  ],

  stats: [
    {
      title: 'Tu resumen',
      body: 'Canciones escuchadas, artistas distintos, tu género favorito y el tiempo total — cuando quieras, no solo una vez al año.',
      targets: ['[data-tour="stats-summary"]'],
    },
    {
      title: 'Tu perfil musical',
      body: 'Qué géneros escuchas y cómo evoluciona tu escucha día a día.',
      targets: ['[data-tour="stats-profile"]'],
      optional: true,
    },
    {
      title: 'Vuelve a escuchar',
      body: 'Toca cualquier canción de tu actividad reciente para ponerla otra vez.',
      targets: ['[data-tour="stats-recent"]'],
      optional: true,
    },
  ],

  friends: [
    {
      title: 'Amigos',
      body: 'BeMusic: la canción del día de tus amigos. Además, tu lista de amigos con chat, las solicitudes y un buscador de usuarios.',
      targets: ['[data-tour="friends-tabs"]'],
    },
  ],

  profile: [
    {
      title: 'Tu algoritmo',
      body: 'Decide cuánto quieres descubrir música nueva, cuánto pesan los éxitos, cuántas canciones seguidas del mismo artista… Spotify no te deja tocar nada de esto.',
      targets: ['#sec-algorithm'],
      optional: true,
    },
    {
      title: 'Reproducción',
      body: 'Calidad y fuente del audio, vídeo de fondo por defecto, guardado sin conexión automático y más.',
      targets: ['#sec-playback'],
      optional: true,
    },
    {
      title: 'Guías',
      body: 'Si quieres volver a ver estas explicaciones, puedes reactivarlas aquí.',
      targets: ['[data-tour="profile-guides"]'],
      optional: true,
    },
  ],

  'artist-studio': [
    {
      title: 'Sube tu música',
      body: 'Publica canciones sueltas o álbumes completos. Aparecen en el catálogo y en las recomendaciones como cualquier artista.',
      targets: ['[data-tour="studio-upload"]'],
      optional: true,
    },
    {
      title: 'Letra y metadatos',
      body: 'En cada canción puedes añadir la letra (con tiempos, si quieres) y el estado de ánimo y etiquetas, que ayudan a recomendarla a quien le pueda gustar.',
      targets: ['[data-tour="studio-track-metadata"]'],
      optional: true,
    },
  ],
};

// ── API pública ───────────────────────────────────────────────────────────────

/** Activa las guías (cuentas nuevas). */
export function enableTours() {
  localStorage.setItem(ENABLED_KEY, 'true');
}

/** Reactiva las guías y olvida qué pantallas se han visto (Perfil → "Ver guías de nuevo"). */
export function resetTours() {
  Object.keys(localStorage).filter((k) => k.startsWith(SEEN_PREFIX)).forEach((k) => localStorage.removeItem(k));
  enableTours();
}

// Cola a nivel de módulo: las pantallas pueden pedir su guía antes de que el
// motor haya registrado su listener (sus efectos corren antes que el de un
// hermano posterior en el árbol), así que no basta con el evento.
const pendingRequests: TourId[] = [];

export function requestTour(id: TourId) {
  if (localStorage.getItem(ENABLED_KEY) !== 'true') return;
  if (localStorage.getItem(SEEN_PREFIX + id) === 'true') return;
  if (!pendingRequests.includes(id)) pendingRequests.push(id);
  window.dispatchEvent(new Event(REQUEST_EVENT));
}

/** Pide la guía de una pantalla cuando `active` pasa a true (al montarse/abrirse). */
export function useScreenTour(id: TourId, active = true) {
  useEffect(() => {
    if (active) requestTour(id);
  }, [id, active]);
}

// ── Motor ─────────────────────────────────────────────────────────────────────

interface Rect { top: number; left: number; width: number; height: number }

function findVisibleTarget(selectors?: string[]): HTMLElement | null {
  if (!selectors) return null;
  for (const sel of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0') return el;
    }
  }
  return null;
}

const PAD = 6;
const CARD_WIDTH = 320;
/** Margen para que la pantalla termine de pintar sus elementos antes de empezar. */
const START_DELAY_MS = 700;

export default function GuidedTour() {
  const [tourId, setTourId] = useState<TourId | null>(null);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const scrolledForStep = useRef(-1);
  const startingRef = useRef(false);

  const tryStartNext = useCallback(() => {
    if (startingRef.current || tourId) return;
    const next = pendingRequests.shift();
    if (!next) return;
    startingRef.current = true;
    const attempt = () => {
      if (document.querySelector('[data-blocks-tour]')) { window.setTimeout(attempt, 1000); return; }
      const available = TOURS[next].filter((s) => !s.optional || findVisibleTarget(s.targets));
      startingRef.current = false;
      if (available.length === 0) { localStorage.setItem(SEEN_PREFIX + next, 'true'); return; }
      scrolledForStep.current = -1;
      setSteps(available);
      setIndex(0);
      setTourId(next);
    };
    window.setTimeout(attempt, START_DELAY_MS);
  }, [tourId]);

  useEffect(() => {
    window.addEventListener(REQUEST_EVENT, tryStartNext);
    tryStartNext(); // peticiones hechas antes de montar el motor
    return () => window.removeEventListener(REQUEST_EVENT, tryStartNext);
  }, [tryStartNext]);

  const finish = useCallback(() => {
    if (tourId) localStorage.setItem(SEEN_PREFIX + tourId, 'true');
    setTourId(null);
  }, [tourId]);

  const disableAll = useCallback(() => {
    localStorage.setItem(ENABLED_KEY, 'false');
    pendingRequests.length = 0;
    finish();
  }, [finish]);

  // Posición del elemento resaltado (se recalcula para seguir cambios de layout y scroll).
  useEffect(() => {
    if (!tourId) return;
    const update = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const step = steps[index];
      const el = findVisibleTarget(step?.targets);
      if (!el) { setRect(null); setUsingFallback(!!step?.targets); return; }
      const primary = step?.targets?.[0];
      setUsingFallback(!!primary && !el.matches(primary));
      if (scrolledForStep.current !== index) {
        scrolledForStep.current = index;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const id = window.setInterval(update, 300);
    window.addEventListener('resize', update);
    return () => { clearInterval(id); window.removeEventListener('resize', update); };
  }, [tourId, index, steps]);

  useEffect(() => {
    if (!tourId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setIndex((i) => (i < steps.length - 1 ? i + 1 : i));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourId, steps.length, finish]);

  // Al terminar una guía, arrancar la siguiente en cola (si la hay).
  useEffect(() => {
    if (!tourId) tryStartNext();
  }, [tourId, tryStartNext]);

  if (!tourId || steps.length === 0) return null;

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const cardWidth = Math.min(CARD_WIDTH, viewport.w - 32);

  // Tarjeta debajo del elemento si cabe; si no, encima (o dentro si el elemento
  // ocupa casi toda la pantalla). Sin elemento: centrada.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const left = Math.min(Math.max(rect.left + rect.width / 2 - cardWidth / 2, 16), viewport.w - cardWidth - 16);
    const spaceBelow = viewport.h - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if (spaceBelow > 240) cardStyle = { top: rect.top + rect.height + PAD + 12, left, width: cardWidth };
    else if (spaceAbove > 240) cardStyle = { bottom: viewport.h - rect.top + PAD + 12, left, width: cardWidth };
    else cardStyle = { bottom: 24, left, width: cardWidth };
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: cardWidth };
  }

  return createPortal(
    <div className="guided-tour" role="dialog" aria-modal="true" aria-label="Guía de KokoMusic">
      {/* Captura los clics para que no se interactúe con la app durante la guía. */}
      <div className={`guided-tour-blocker ${rect ? '' : 'dimmed'}`} />
      {rect && (
        <div
          className="guided-tour-spotlight"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      )}
      <div className="guided-tour-card" style={cardStyle}>
        {steps.length > 1 && <div className="guided-tour-progress">{index + 1} / {steps.length}</div>}
        <h3 className="guided-tour-title">{step.title}</h3>
        <p className="guided-tour-body">{step.body}</p>
        {usingFallback && step.fallbackNote && <p className="guided-tour-note">{step.fallbackNote}</p>}
        <div className="guided-tour-actions">
          <button className="guided-tour-skip" onClick={disableAll} title="No volver a mostrar ninguna guía">
            No mostrar más guías
          </button>
          <div style={{ flex: 1 }} />
          {index > 0 && <button className="guided-tour-btn secondary" onClick={() => setIndex(index - 1)}>Atrás</button>}
          <button className="guided-tour-btn" onClick={() => (isLast ? finish() : setIndex(index + 1))}>
            {isLast ? 'Entendido' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
