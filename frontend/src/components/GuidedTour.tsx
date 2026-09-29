import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Guía interactiva para usuarios nuevos: recorre la propia interfaz
 * resaltando cada elemento real (marcado con data-tour="…") y explicando lo
 * que KokoMusic tiene respecto a Spotify.
 *
 * - Se lanza sola una vez tras crear cuenta (markTourPending) y siempre que
 *   se quiera desde Perfil (startGuidedTour).
 * - Espera a que no haya ningún modal marcado con data-blocks-tour abierto
 *   (p.ej. el de gustos iniciales) para no pisarlo.
 * - Cada paso lista selectores en orden de preferencia: si el de escritorio
 *   está oculto (móvil), prueba el siguiente; si no hay ninguno visible, el
 *   paso se muestra centrado sin resaltar, o se omite si es `optional`.
 */

const TOUR_PENDING_KEY = 'koko_tour_pending';
const TOUR_DONE_KEY = 'koko_tour_done';
const START_EVENT = 'koko-start-tour';

export function markTourPending() {
  localStorage.setItem(TOUR_PENDING_KEY, 'true');
}

export function startGuidedTour() {
  window.dispatchEvent(new Event(START_EVENT));
}

interface TourStep {
  title: string;
  body: string;
  targets?: string[];
  optional?: boolean;
  /** Se muestra cuando el primer selector no está visible y se usa uno alternativo (móvil). */
  fallbackNote?: string;
}

const STEPS: TourStep[] = [
  {
    title: '¡Bienvenido a KokoMusic! 🎵',
    body: 'En un minuto te enseñamos lo que KokoMusic tiene y Spotify no. Puedes saltar la guía cuando quieras y repetirla desde tu Perfil.',
  },
  {
    title: 'Letras inmersivas y karaoke',
    body: 'Letras sincronizadas a pantalla completa con traducción al instante, efectos, tamaños y colores a tu gusto, y modo karaoke palabra a palabra.',
    targets: ['[data-tour="lyrics"]', '[data-tour="player"]'],
    fallbackNote: 'En el móvil: pon una canción, toca el reproductor de abajo para abrirlo a pantalla completa y pulsa «Letras».',
  },
  {
    title: 'Sinfonía: escucha en grupo',
    body: 'Crea una sala y comparte el código: tus amigos escuchan lo mismo que tú a la vez, con una cola colaborativa donde todos votan.',
    targets: ['[data-tour="sinfonia"]', '[data-tour="player"]'],
    fallbackNote: 'En el móvil: pon una canción, toca el reproductor de abajo para abrirlo a pantalla completa y pulsa «Sinfonía».',
  },
  {
    title: 'Dispositivos (como Spotify Connect)',
    body: 'Conecta tu móvil y tu ordenador: controla desde uno lo que suena en el otro, o pásate la música de un dispositivo a otro sin cortes.',
    targets: ['[data-tour="devices"]', '[data-tour="player"]'],
    fallbackNote: 'En el móvil: pon una canción, toca el reproductor de abajo para abrirlo a pantalla completa y pulsa «Dispositivos».',
  },
  {
    title: 'Ecualizador',
    body: 'Ajusta graves, medios y agudos con un ecualizador de 5 bandas y presets — algo que Spotify no tiene en la web.',
    targets: ['[data-tour="eq"]'],
    optional: true,
  },
  {
    title: 'Modo DJ',
    body: 'Mezcla tus canciones como un DJ: transiciones personalizadas entre temas, hot cues, loops y efectos en directo (slowed, reverb, filtro).',
    targets: ['[data-tour="dj"]', '[data-tour="more"]'],
    fallbackNote: 'En el móvil lo tienes en el menú «Más».',
  },
  {
    title: 'Estudio Karaoke',
    body: 'Canta encima de cualquier canción con las letras en pantalla grande.',
    targets: ['[data-tour="karaoke"]', '[data-tour="more"]'],
    fallbackNote: 'En el móvil lo tienes en el menú «Más».',
  },
  {
    title: 'Estadísticas todo el año',
    body: 'Tus canciones, artistas y géneros más escuchados, tu evolución y tus rachas — cuando quieras, no solo una vez al año como el Wrapped.',
    targets: ['[data-tour="stats"]', '[data-tour="more"]'],
    fallbackNote: 'En el móvil las tienes en el menú «Más».',
  },
  {
    title: 'Amigos',
    body: 'Añade amigos, chatea con ellos, mira sus perfiles e invítalos a tus Sinfonías y playlists colaborativas.',
    targets: ['[data-tour="friends"]', '[data-tour="friends-mobile"]'],
  },
  {
    title: 'Control por voz',
    body: 'Pide canciones, pausa o salta con la voz (también con Alt + V en el ordenador).',
    targets: ['[data-tour="voice"]'],
    optional: true,
  },
  {
    title: 'Tu diseño',
    body: 'Cambia el color de acento, el fondo, las esquinas, la densidad y más. La app entera se adapta a tu estilo.',
    targets: ['[data-tour="theme"]'],
    optional: true,
  },
  {
    title: 'Ajustes que Spotify no te da',
    body: 'En tu Perfil puedes afinar el algoritmo de recomendaciones (cuánto explorar, peso de lo popular…), elegir la fuente de audio, activar el vídeo de fondo, guardar canciones sin conexión automáticamente, importar tu historial de Spotify y hasta hacerte artista para subir tu música.',
    targets: ['[data-tour="profile"]', '[data-tour="more"]'],
    fallbackNote: 'Tu Perfil está en el menú «Más».',
  },
  {
    title: '¡Listo!',
    body: 'Ya lo tienes todo. Si quieres repasar la guía, está en tu Perfil. ¡A disfrutar de la música!',
  },
];

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

export default function GuidedTour() {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState<TourStep[]>(STEPS);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const scrolledForStep = useRef(-1);

  const begin = useCallback(() => {
    // Los pasos opcionales sin elemento visible (p.ej. el ecualizador en móvil) se omiten.
    setSteps(STEPS.filter((s) => !s.optional || findVisibleTarget(s.targets)));
    setIndex(0);
    scrolledForStep.current = -1;
    setActive(true);
  }, []);

  const finish = useCallback(() => {
    localStorage.setItem(TOUR_DONE_KEY, 'true');
    localStorage.removeItem(TOUR_PENDING_KEY);
    setActive(false);
  }, []);

  // Arranque manual (desde Perfil).
  useEffect(() => {
    window.addEventListener(START_EVENT, begin);
    return () => window.removeEventListener(START_EVENT, begin);
  }, [begin]);

  // Arranque automático tras crear cuenta, cuando no haya ningún modal bloqueante.
  useEffect(() => {
    if (localStorage.getItem(TOUR_PENDING_KEY) !== 'true') return;
    const id = window.setInterval(() => {
      if (localStorage.getItem(TOUR_PENDING_KEY) !== 'true') { clearInterval(id); return; }
      if (document.querySelector('[data-blocks-tour]')) return;
      clearInterval(id);
      begin();
    }, 1500);
    return () => clearInterval(id);
  }, [begin]);

  // Posición del elemento resaltado (se recalcula para seguir cambios de layout y scroll).
  useEffect(() => {
    if (!active) return;
    const update = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
      const el = findVisibleTarget(steps[index]?.targets);
      // Sin elemento visible (p.ej. el mini reproductor aún no existe porque no
      // suena nada) también cuenta como alternativa: la nota explica dónde está.
      if (!el) { setRect(null); setUsingFallback(!!steps[index]?.targets); return; }
      const primary = steps[index]?.targets?.[0];
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
  }, [active, index, steps]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight') setIndex((i) => (i < steps.length - 1 ? i + 1 : i));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, steps.length, finish]);

  if (!active) return null;

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const cardWidth = Math.min(CARD_WIDTH, viewport.w - 32);

  // Tarjeta debajo del elemento si cabe; si no, encima. Sin elemento: centrada.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const left = Math.min(Math.max(rect.left + rect.width / 2 - cardWidth / 2, 16), viewport.w - cardWidth - 16);
    const spaceBelow = viewport.h - (rect.top + rect.height);
    cardStyle = spaceBelow > 240
      ? { top: rect.top + rect.height + PAD + 12, left, width: cardWidth }
      : { bottom: viewport.h - rect.top + PAD + 12, left, width: cardWidth };
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
        <div className="guided-tour-progress">{index + 1} / {steps.length}</div>
        <h3 className="guided-tour-title">{step.title}</h3>
        <p className="guided-tour-body">{step.body}</p>
        {usingFallback && step.fallbackNote && <p className="guided-tour-note">{step.fallbackNote}</p>}
        <div className="guided-tour-actions">
          {!isLast && <button className="guided-tour-skip" onClick={finish}>Saltar guía</button>}
          <div style={{ flex: 1 }} />
          {index > 0 && <button className="guided-tour-btn secondary" onClick={() => setIndex(index - 1)}>Atrás</button>}
          <button className="guided-tour-btn" onClick={() => (isLast ? finish() : setIndex(index + 1))}>
            {isLast ? '¡Empezar!' : index === 0 ? 'Vamos' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
