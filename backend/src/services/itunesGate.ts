/**
 * Control de uso de la API de iTunes (límite aproximado: ~20 peticiones/min
 * por IP; al pasarse responde 429 durante un rato).
 *
 * - Tras un 429 se hace una pausa global: mientras dura, la búsqueda principal
 *   va directa a Deezer (sin perder el intento + reintento) y no se hacen
 *   consultas secundarias.
 * - Las consultas secundarias (completar resultados de YouTube con datos de
 *   iTunes) tienen un cupo propio para no gastar el de las búsquedas que ve
 *   el usuario. Antes cada búsqueda de YouTube lanzaba hasta 12 de golpe.
 */

const COOLDOWN_MS = 60_000;
const BACKGROUND_PER_MIN = 15;

let cooldownUntil = 0;
let tokens = BACKGROUND_PER_MIN;
let lastRefill = Date.now();

/** iTunes nos está limitando: mejor no llamar. */
export function itunesCoolingDown(): boolean {
  return Date.now() < cooldownUntil;
}

/** Registrar el código de cada respuesta de iTunes (activa la pausa si es 429/403). */
export function noteItunesStatus(status: number): void {
  if (status === 429 || status === 403) {
    if (!itunesCoolingDown()) console.warn(`[iTunes] ${status}: pausa de ${COOLDOWN_MS / 1000}s en consultas a iTunes`);
    cooldownUntil = Date.now() + COOLDOWN_MS;
  }
}

/** Reserva una consulta secundaria. false = no hay cupo ahora (usar lo que haya sin red). */
export function takeBackgroundItunesSlot(): boolean {
  if (itunesCoolingDown()) return false;
  const now = Date.now();
  tokens = Math.min(BACKGROUND_PER_MIN, tokens + ((now - lastRefill) / 60_000) * BACKGROUND_PER_MIN);
  lastRefill = now;
  if (tokens < 1) return false;
  tokens -= 1;
  return true;
}
