import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore';

/** Track which iframe contentWindows have a ready YT player */
const readyIframes = new WeakSet<Window>();

/** Safe postMessage wrapper — silently swallows all errors */
function postYT(win: Window | null | undefined, msg: object) {
  if (!win) return;
  try {
    win.postMessage(JSON.stringify(msg), '*');
  } catch {
    // ignore cross-origin / not-ready errors
  }
}

/** Listen for YouTube's onReady signal and mark the iframe as ready */
function waitForYTReady(iframe: HTMLIFrameElement, onReady: () => void) {
  const handler = (e: MessageEvent) => {
    if (!iframe.contentWindow || e.source !== iframe.contentWindow) return;
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data?.event === 'onReady' || data?.info?.playerState !== undefined) {
        readyIframes.add(iframe.contentWindow);
        window.removeEventListener('message', handler);
        onReady();
      }
    } catch {}
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function useVideoSync(iframe: HTMLIFrameElement | null, youtubeId: string | null) {
  const { isPlaying, progress, volume, isMuted, isEmbedMode } = usePlayerStore();
  const lastProgressRef = useRef(0);
  const isReadyRef = useRef(false);

  // Sincronización inicial al cargar el vídeo (cuando cambia youtubeId o se monta el iframe)
  useEffect(() => {
    if (!iframe || !youtubeId) return;
    isReadyRef.current = false;

    // Subscribe to YouTube ready event first
    const cancelWait = waitForYTReady(iframe, () => {
      isReadyRef.current = true;
      const store = usePlayerStore.getState();
      postYT(iframe.contentWindow, { event: 'command', func: 'seekTo', args: [store.progress, true] });
      if (!store.isEmbedMode) {
        postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
      } else if (store.isMuted) {
        postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
      } else {
        postYT(iframe.contentWindow, { event: 'command', func: 'unMute', args: [] });
        postYT(iframe.contentWindow, { event: 'command', func: 'setVolume', args: [Math.round(store.volume * 100)] });
      }
      postYT(iframe.contentWindow, {
        event: 'command',
        func: store.isPlaying ? 'playVideo' : 'pauseVideo',
        args: [],
      });
    });

    // Fallback retries with increasing delays (in case onReady fires before we listen)
    const delays = [800, 2000, 4000];
    const timers = delays.map(delay =>
      setTimeout(() => {
        if (isReadyRef.current) return; // already handled
        const store = usePlayerStore.getState();
        if (!iframe.contentWindow) return;
        isReadyRef.current = true;
        readyIframes.add(iframe.contentWindow);
        postYT(iframe.contentWindow, { event: 'command', func: 'seekTo', args: [store.progress, true] });
        if (!store.isEmbedMode) {
          postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
        } else if (store.isMuted) {
          postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
        } else {
          postYT(iframe.contentWindow, { event: 'command', func: 'unMute', args: [] });
          postYT(iframe.contentWindow, { event: 'command', func: 'setVolume', args: [Math.round(store.volume * 100)] });
        }
        postYT(iframe.contentWindow, {
          event: 'command',
          func: store.isPlaying ? 'playVideo' : 'pauseVideo',
          args: [],
        });
      }, delay)
    );

    lastProgressRef.current = usePlayerStore.getState().progress;

    return () => {
      cancelWait();
      timers.forEach(clearTimeout);
    };
  }, [youtubeId, iframe]);

  // Sincronizar estado play/pause
  useEffect(() => {
    if (!iframe || !iframe.contentWindow || !youtubeId || !isReadyRef.current) return;

    const timeout = setTimeout(() => {
      const command = isPlaying ? 'playVideo' : 'pauseVideo';
      postYT(iframe.contentWindow, { event: 'command', func: command, args: [] });
    }, 200);

    return () => clearTimeout(timeout);
  }, [isPlaying, youtubeId, iframe]);

  // Sincronizar volumen y mute
  useEffect(() => {
    if (!iframe || !iframe.contentWindow || !youtubeId || !isReadyRef.current) return;

    if (!isEmbedMode) {
      postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
    } else if (isMuted) {
      postYT(iframe.contentWindow, { event: 'command', func: 'mute', args: [] });
    } else {
      postYT(iframe.contentWindow, { event: 'command', func: 'unMute', args: [] });
      postYT(iframe.contentWindow, { event: 'command', func: 'setVolume', args: [Math.round(volume * 100)] });
    }
  }, [volume, isMuted, isEmbedMode, youtubeId, iframe]);

  // Sincronizar barra de progreso (seek)
  useEffect(() => {
    if (!iframe || !iframe.contentWindow || !youtubeId || !isReadyRef.current) return;

    const timeDiff = Math.abs(progress - lastProgressRef.current);
    // Si el tiempo salta más de 1.5 segundos, asumimos un seek manual
    if (timeDiff > 1.5) {
      postYT(iframe.contentWindow, { event: 'command', func: 'seekTo', args: [progress, true] });
      postYT(iframe.contentWindow, {
        event: 'command',
        func: isPlaying ? 'playVideo' : 'pauseVideo',
        args: [],
      });
    }
    lastProgressRef.current = progress;
  }, [progress, isPlaying, youtubeId, iframe]);
}
