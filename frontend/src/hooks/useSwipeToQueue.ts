import { useState } from 'react';
import type { Track } from '../lib/api';

export function useSwipeToQueue(
  track: Track,
  addToQueue: (track: Track) => void,
  setError: (msg: string) => void
) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const onTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setIsSwiping(false);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStart.x;
    const diffY = touch.clientY - touchStart.y;

    if (Math.abs(diffX) > Math.abs(diffY)) {
      // Horizontal swipe
      if (diffX > 0) {
        if (e.cancelable) e.preventDefault();
        setIsSwiping(true);
        // Damping resistance for longer swipes
        const val = diffX > 150 ? 150 + (diffX - 150) * 0.25 : diffX;
        setSwipeOffset(val);
      }
    }
  };

  const onTouchEnd = () => {
    if (isSwiping && swipeOffset > 80) {
      addToQueue(track);
      setError(`Añadido a la cola: ${track.title}`);
    }
    setTouchStart(null);
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  return {
    swipeStyle: {
      transform: swipeOffset > 0 ? `translateX(${swipeOffset}px)` : undefined,
      transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
    },
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    swipeOffset,
  };
}
