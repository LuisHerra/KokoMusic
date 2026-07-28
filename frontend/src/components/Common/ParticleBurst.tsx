/**
 * ParticleBurst — Reusable Interactive Particle Animation Component
 *
 * Spawns floating particles (musical notes 🎵, sparkles ✨, hearts ♥, plus ➕, stars 🌟)
 * that explode radially when triggered on user interactions (play, like, queue, Eureka match).
 */

import React, { useState, useEffect, useRef } from 'react';

export type ParticleType = 'heart' | 'note' | 'sparkle' | 'plus' | 'star';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  angle: number;
  speed: number;
  color: string;
  char: string;
}

interface ParticleBurstProps {
  type?: ParticleType;
  count?: number;
  triggerKey?: any; // Change triggerKey to fire burst
  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

const PARTICLE_CHARS: Record<ParticleType, string[]> = {
  heart: ['♥', '💖', '💗', '❤️'],
  note: ['🎵', '🎶', '🎼', '✨'],
  sparkle: ['✨', '🌟', '💫', '⚡'],
  plus: ['➕', '🎵', '✨'],
  star: ['🌟', '⭐', '✨'],
};

const PARTICLE_COLORS: Record<ParticleType, string[]> = {
  heart: ['#ff2a5f', '#ff4d79', '#ff0055', '#e11d48', '#fb7185'],
  note: ['#00d2ff', '#38bdf8', '#818cf8', '#c084fc', '#a855f7'],
  sparkle: ['#fbbf24', '#f59e0b', '#38bdf8', '#34d399', '#f472b6'],
  plus: ['#10b981', '#34d399', '#38bdf8', '#a855f7'],
  star: ['#f59e0b', '#fbbf24', '#eab308', '#facc15'],
};

export default function ParticleBurst({
  type = 'sparkle',
  count = 8,
  triggerKey,
  children,
  style = {},
  className = '',
  onClick,
}: ParticleBurstProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const nextIdRef = useRef(0);

  const spawnParticles = () => {
    const chars = PARTICLE_CHARS[type];
    const colors = PARTICLE_COLORS[type];
    const newParticles: Particle[] = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
      const speed = 20 + Math.random() * 30;
      newParticles.push({
        id: nextIdRef.current++,
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed - 12,
        size: 10 + Math.random() * 8,
        angle: (Math.random() - 0.5) * 40,
        speed,
        color: colors[Math.floor(Math.random() * colors.length)],
        char: chars[Math.floor(Math.random() * chars.length)],
      });
    }

    setParticles(newParticles);
    setTimeout(() => {
      setParticles([]);
    }, 850);
  };

  useEffect(() => {
    if (triggerKey !== undefined && triggerKey !== null && triggerKey !== false) {
      spawnParticles();
    }
  }, [triggerKey]);

  const handleClick = (e: React.MouseEvent) => {
    spawnParticles();
    if (onClick) onClick(e);
  };

  return (
    <div
      className={className}
      onClick={handleClick}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <style>{`
        @keyframes burstFly {
          0% {
            opacity: 1;
            transform: translate(0, 0) scale(0.4) rotate(0deg);
          }
          50% {
            opacity: 0.95;
            transform: translate(var(--dx), var(--dy)) scale(1.2) rotate(var(--rot));
          }
          100% {
            opacity: 0;
            transform: translate(calc(var(--dx) * 1.4), calc(var(--dy) * 1.4 - 15px)) scale(0.2) rotate(calc(var(--rot) * 1.5));
          }
        }
      `}</style>

      {/* Render Particles */}
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 999,
            fontSize: `${p.size}px`,
            color: p.color,
            filter: 'drop-shadow(0 0 6px rgba(255, 255, 255, 0.4))',
            animation: 'burstFly 0.85s ease-out forwards',
            '--dx': `${p.x}px`,
            '--dy': `${p.y}px`,
            '--rot': `${p.angle}deg`,
          } as any}
        >
          {p.char}
        </span>
      ))}

      {children}
    </div>
  );
}
