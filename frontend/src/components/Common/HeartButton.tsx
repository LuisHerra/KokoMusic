/**
 * HeartButton — Interactive Animated Like Button with Particle Burst
 *
 * Spawns mini floating heart particles popping out radially from the heart
 * with elastic scale, rotation, and smooth fade-out when liked.
 */

import React, { useState, useRef } from 'react';

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  angle: number;
  speed: number;
  color: string;
}

export default function HeartButton({
  isLiked,
  onClick,
  size = 20,
  className = '',
  title = '',
  style = {},
}: {
  isLiked: boolean;
  onClick: (e: React.MouseEvent) => void;
  size?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [isBouncing, setIsBouncing] = useState(false);
  const nextIdRef = useRef(0);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick(e);

    // Trigger particle burst animation on like
    if (!isLiked) {
      setIsBouncing(true);
      setTimeout(() => setIsBouncing(false), 400);

      const colors = ['#ff2a5f', '#ff4d79', '#ff0055', '#e11d48', '#f43f5e', '#fb7185'];
      const newParticles: Particle[] = [];

      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * 2 * Math.PI + (Math.random() - 0.5) * 0.4;
        const speed = 22 + Math.random() * 32;
        newParticles.push({
          id: nextIdRef.current++,
          x: Math.cos(angle) * speed,
          y: Math.sin(angle) * speed - 18, // upward bias
          size: 10 + Math.random() * 8,
          angle: (Math.random() - 0.5) * 45,
          speed,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }

      setParticles(newParticles);

      setTimeout(() => {
        setParticles([]);
      }, 850);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`
        @keyframes heartPop {
          0% { transform: scale(1); }
          50% { transform: scale(1.35) rotate(-8deg); }
          100% { transform: scale(1); }
        }
        @keyframes particleBurst {
          0% {
            opacity: 1;
            transform: translate(0, 0) scale(0.4) rotate(0deg);
          }
          50% {
            opacity: 0.9;
            transform: translate(var(--dx), var(--dy)) scale(1.2) rotate(var(--rot));
          }
          100% {
            opacity: 0;
            transform: translate(calc(var(--dx) * 1.35), calc(var(--dy) * 1.4 - 20px)) scale(0.3) rotate(calc(var(--rot) * 1.4));
          }
        }
      `}</style>

      {/* Render Floating Heart Particles */}
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 99,
            fontSize: `${p.size}px`,
            color: p.color,
            filter: 'drop-shadow(0 0 6px rgba(255, 42, 95, 0.6))',
            animation: 'particleBurst 0.85s ease-out forwards',
            '--dx': `${p.x}px`,
            '--dy': `${p.y}px`,
            '--rot': `${p.angle}deg`,
          } as any}
        >
          ♥
        </span>
      ))}

      {/* Main Heart Icon */}
      <button
        type="button"
        className={className}
        onClick={handleClick}
        title={title || (isLiked ? 'Quitar de Me Gusta' : 'Me Gusta')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isLiked ? '#ff2a5f' : 'var(--text-secondary)',
          transition: 'color 0.2s ease, transform 0.15s ease',
          animation: isBouncing ? 'heartPop 0.4s ease-out' : 'none',
          ...style,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={isLiked ? '#ff2a5f' : 'none'}
          stroke={isLiked ? '#ff2a5f' : 'currentColor'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            filter: isLiked ? 'drop-shadow(0 0 8px rgba(255, 42, 95, 0.5))' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </div>
  );
}
