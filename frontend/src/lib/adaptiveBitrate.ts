/**
 * adaptiveBitrate.ts — Motor de Bitrate Elástico / Adaptativo estilo Spotify
 *
 * Ajusta dinámicamente la calidad del stream de audio según:
 *   1. Network Information API (effectiveType, downlink Mbps, RTT, Data Saver)
 *   2. Estado de salud del buffer de audio (detección de stalls / rebuffering)
 *   3. Tipo de dispositivo (móvil vs escritorio) y preferencia del usuario en perfil
 */

export type AudioQualityLevel = 'low' | 'medium' | 'high';

interface NetworkInformation extends EventTarget {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g';
  downlink?: number; // Mb/s
  rtt?: number;      // ms
  saveData?: boolean;
  onchange?: EventListener;
}

let recentStalls: number[] = [];
let currentAdaptiveQuality: AudioQualityLevel = 'high';
const listeners = new Set<(q: AudioQualityLevel) => void>();

function getConnection(): NetworkInformation | null {
  if (typeof navigator === 'undefined') return null;
  return (
    (navigator as any).connection ||
    (navigator as any).mozConnection ||
    (navigator as any).webkitConnection ||
    null
  );
}

/**
 * Calcula la calidad de audio recomendada basada en las condiciones actuales de red.
 */
function evaluateNetworkQuality(): AudioQualityLevel {
  // 1. Respetar preferencia manual fija si el usuario la configuró (ej. en Ajustes)
  try {
    const saved = localStorage.getItem('koko_audio_quality');
    if (saved === '96') return 'low';
    if (saved === '160') return 'medium';
    if (saved === '320') return 'high';
  } catch {}

  const conn = getConnection();

  // 2. Si el usuario activó "Modo Ahorro de Datos" en el móvil/navegador
  if (conn?.saveData) {
    return 'low';
  }

  // 3. Revisar frecuencia de stalls (microcortes de buffer en los últimos 25s)
  const now = Date.now();
  recentStalls = recentStalls.filter((t) => now - t < 25000);
  if (recentStalls.length >= 2) {
    // Red bajando o con congestión severa -> forzar calidad baja para evitar cortes
    return 'low';
  } else if (recentStalls.length === 1) {
    // Corte reciente detectado -> no subir de calidad media
    return 'medium';
  }

  // 4. Si tenemos Network Information API activa
  if (conn) {
    const { effectiveType, downlink, rtt } = conn;

    // Conexiones lentas (2G o RTT muy elevado > 400ms o downlink < 1.0 Mbps)
    if (
      effectiveType === 'slow-2g' ||
      effectiveType === '2g' ||
      (downlink !== undefined && downlink < 1.0) ||
      (rtt !== undefined && rtt > 400)
    ) {
      return 'low';
    }

    // Conexiones intermedias (3G o 4G con cobertura reducida)
    if (
      effectiveType === '3g' ||
      (downlink !== undefined && downlink < 2.5) ||
      (rtt !== undefined && rtt > 220)
    ) {
      return 'medium';
    }

    // Conexiones rápidas (4G/5G o WiFi estable con buen ancho de banda)
    return 'high';
  }

  // 5. Fallback móvil genérico
  const isMobile = typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  return isMobile ? 'medium' : 'high';
}

function updateAdaptiveQuality() {
  const newQuality = evaluateNetworkQuality();
  if (newQuality !== currentAdaptiveQuality) {
    currentAdaptiveQuality = newQuality;
    listeners.forEach((fn) => fn(newQuality));
  }
}

// Inicializar listener de cambio de red si está soportado
if (typeof window !== 'undefined') {
  const conn = getConnection();
  if (conn) {
    conn.addEventListener('change', updateAdaptiveQuality);
  }
  // Evaluar inicial
  currentAdaptiveQuality = evaluateNetworkQuality();
}

/**
 * Obtiene la calidad adaptativa recomendada para la siguiente petición de stream
 */
export function getAdaptiveQuality(): AudioQualityLevel {
  return evaluateNetworkQuality();
}

/**
 * Registra un stall (evento 'waiting' de buffer) en el reproductor
 */
export function reportAudioStall() {
  recentStalls.push(Date.now());
  updateAdaptiveQuality();
}

/**
 * Informa que el audio lleva reproduciendo sin cortes
 */
export function reportAudioHealthy() {
  if (recentStalls.length > 0) {
    recentStalls = [];
    updateAdaptiveQuality();
  }
}

/**
 * Retorna una etiqueta amigable de calidad actual para mostrar al usuario
 */
export function getAdaptiveQualityLabel(): string {
  const q = evaluateNetworkQuality();
  switch (q) {
    case 'low':
      return 'Adaptativa (~96 kbps - Ahorro)';
    case 'medium':
      return 'Adaptativa (~160 kbps - Fluida)';
    case 'high':
    default:
      return 'Adaptativa (~320 kbps - Óptima)';
  }
}
