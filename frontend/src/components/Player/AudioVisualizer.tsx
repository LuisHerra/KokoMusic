import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { getAudioAnalyser } from '../../hooks/useAudioPlayer';

export type VisualizerType = 'bars' | 'wave' | 'circle';
export type VisualizerColorMode = 'cover' | 'gradient' | 'white' | 'custom';

interface AudioVisualizerProps {
  height?: string | number;
  width?: string | number;
}

export default function AudioVisualizer({ height = '100%', width = '100%' }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  
  const { isPlaying, dominantColor, isEmbedMode, currentTrack } = usePlayerStore();
  
  // Settings loaded from localStorage or defaults
  const [visualizerType, setVisualizerType] = useState<VisualizerType>(() => {
    return (localStorage.getItem('koko_vis_type') as VisualizerType) || 'wave';
  });
  const [colorMode, setColorMode] = useState<VisualizerColorMode>(() => {
    return (localStorage.getItem('koko_vis_color_mode') as VisualizerColorMode) || 'cover';
  });
  const [customColor, setCustomColor] = useState<string>(() => {
    return localStorage.getItem('koko_vis_custom_color') || '#1DB954';
  });
  const [customColorSecondary, setCustomColorSecondary] = useState<string>(() => {
    return localStorage.getItem('koko_vis_custom_color_sec') || '#191414';
  });
  const [showSettings, setShowSettings] = useState(false);

  // Cover image color extraction
  const [extractedColor, setExtractedColor] = useState<string>('#1DB954');
  const [extractedGradientColors, setExtractedGradientColors] = useState<[string, string]>(['#1DB954', '#191414']);

  // Extract color directly from track cover
  useEffect(() => {
    if (!currentTrack?.cover) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let r = 0, g = 0, b = 0, count = 0;
      let r1 = 0, g1 = 0, b1 = 0, c1 = 0;
      let r2 = 0, g2 = 0, b2 = 0, c2 = 0;
      
      for (let y = 0; y < 64; y++) {
         for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            if (data[i+3] < 255) continue;
            const avg = (data[i] + data[i+1] + data[i+2]) / 3;
            if (avg > 20 && avg < 240) {
               r += data[i]; g += data[i+1]; b += data[i+2]; count++;
               if (x + y < 64) {
                  r1 += data[i]; g1 += data[i+1]; b1 += data[i+2]; c1++;
               } else {
                  r2 += data[i]; g2 += data[i+1]; b2 += data[i+2]; c2++;
               }
            }
         }
      }
      
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      let primary = '#1DB954';
      if (count > 0) {
        primary = `#${toHex(Math.floor(r/count))}${toHex(Math.floor(g/count))}${toHex(Math.floor(b/count))}`;
        setExtractedColor(primary);
      }
      
      const hex1 = c1 > 0 ? `#${toHex(Math.floor(r1/c1))}${toHex(Math.floor(g1/c1))}${toHex(Math.floor(b1/c1))}` : primary;
      const hex2 = c2 > 0 ? `#${toHex(Math.floor(r2/c2))}${toHex(Math.floor(g2/c2))}${toHex(Math.floor(b2/c2))}` : primary;
      setExtractedGradientColors([hex1, hex2]);
    };
    img.src = currentTrack.cover;
  }, [currentTrack?.cover]);

  // Sync settings with localStorage
  useEffect(() => {
    localStorage.setItem('koko_vis_type', visualizerType);
  }, [visualizerType]);

  useEffect(() => {
    localStorage.setItem('koko_vis_color_mode', colorMode);
  }, [colorMode]);

  useEffect(() => {
    localStorage.setItem('koko_vis_custom_color', customColor);
  }, [customColor]);

  useEffect(() => {
    localStorage.setItem('koko_vis_custom_color_sec', customColorSecondary);
  }, [customColorSecondary]);

  // Resolve color
  const getPrimaryColor = () => {
    switch (colorMode) {
      case 'white':
        return '#ffffff';
      case 'custom':
        return customColor;
      case 'cover':
      case 'gradient':
      default:
        return extractedColor || dominantColor || '#1DB954';
    }
  };

  const getGradientColors = (color: string): [string, string] => {
    if (colorMode === 'custom') {
      return [customColor, customColorSecondary];
    }
    if (colorMode === 'white') {
      return ['#ffffff', 'rgba(255, 255, 255, 0.15)'];
    }
    if (colorMode === 'gradient') {
      return extractedGradientColors;
    }
    // cover mode / Auto Sólido: fade to transparent/dark
    return [color, color + '1a'];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let localAnalyser = getAudioAnalyser();
    const dataArray = new Uint8Array(localAnalyser ? localAnalyser.frequencyBinCount : 128);

    // Dynamic resize handler that supports high-DPI screens
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Helper to generate simulated wave/bars if no audio is playing or in embed mode
    let simTime = 0;
    const drawSimulated = (width: number, height: number, color: string) => {
      simTime += isPlaying ? 0.05 : 0.01;
      ctx.clearRect(0, 0, width, height);

      const gradColors = getGradientColors(color);

      if (visualizerType === 'bars') {
        const barWidth = (width / 40);
        const gap = 3;
        for (let i = 0; i < 40; i++) {
          const sinVal1 = Math.sin(i * 0.15 + simTime * 1.5);
          const sinVal2 = Math.cos(i * 0.3 - simTime * 0.8);
          const amplitude = isPlaying ? 0.7 : 0.15;
          const factor = (sinVal1 * 0.5 + sinVal2 * 0.5 + 1) / 2 * amplitude;
          const barHeight = Math.max(4, height * 0.8 * factor);
          const x = i * (barWidth + gap);
          const y = height - barHeight;

          // Draw gradient
          const gradient = ctx.createLinearGradient(x, y, x, height);
          gradient.addColorStop(0, gradColors[0]);
          gradient.addColorStop(1, gradColors[1]);

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
          ctx.fill();
        }
      } else if (visualizerType === 'wave') {
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = gradColors[0];

        const drawSingleWave = (offset: number, amplitudeMult: number, opacity: number) => {
          ctx.beginPath();
          const gradient = ctx.createLinearGradient(0, 0, width, 0);
          gradient.addColorStop(0, gradColors[0] + Math.round(opacity * 255).toString(16).padStart(2, '0'));
          gradient.addColorStop(1, gradColors[1] + Math.round(opacity * 255).toString(16).padStart(2, '0'));
          ctx.strokeStyle = gradient;

          for (let x = 0; x < width; x++) {
            const angle = (x / width) * Math.PI * 2.5 + simTime * 2 + offset;
            const amp = isPlaying ? height * 0.25 : height * 0.05;
            const y = height / 2 + Math.sin(angle) * amp * amplitudeMult * Math.sin(x / width * Math.PI);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };

        drawSingleWave(0, 1.0, 0.8);
        drawSingleWave(Math.PI / 3, 0.6, 0.4);
        drawSingleWave(-Math.PI / 4, 0.4, 0.2);
        
        ctx.shadowBlur = 0; // Reset
      } else if (visualizerType === 'circle') {
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.22;
        const pulse = isPlaying ? Math.sin(simTime * 4) * 8 : 0;
        const radius = baseRadius + pulse;

        // Draw radial bars
        const numPoints = 80;
        ctx.shadowBlur = 15;
        ctx.shadowColor = gradColors[0];
        
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          const sinVal = Math.sin(i * 0.25 + simTime * 2.5);
          const amp = isPlaying ? 35 : 5;
          const length = Math.max(2, (sinVal + 1.2) * amp);
          
          const x1 = centerX + Math.cos(angle) * radius;
          const y1 = centerY + Math.sin(angle) * radius;
          const x2 = centerX + Math.cos(angle) * (radius + length);
          const y2 = centerY + Math.sin(angle) * (radius + length);

          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, gradColors[0]);
          gradient.addColorStop(1, gradColors[1]);

          ctx.strokeStyle = gradient;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Draw inner circle fill
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
        ctx.strokeStyle = gradColors[0];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w === 0 || h === 0) return;

      const pColor = getPrimaryColor();
      const gradColors = getGradientColors(pColor);

      // Ensure we check for active analyser again in case AudioContext initialized late
      if (!localAnalyser) {
        localAnalyser = getAudioAnalyser();
      }

      // If YouTube embed mode or audio node analyzer is not available / has no data, use simulated rendering
      if (isEmbedMode || !localAnalyser) {
        drawSimulated(w, h, pColor);
        return;
      }

      // Fetch actual audio data
      if (visualizerType === 'wave') {
        localAnalyser.getByteTimeDomainData(dataArray);
      } else {
        localAnalyser.getByteFrequencyData(dataArray);
      }

      // Check if data is completely empty (e.g. paused or no stream context yet)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += Math.abs(dataArray[i] - (visualizerType === 'wave' ? 128 : 0));
      }

      if (sum === 0) {
        drawSimulated(w, h, pColor);
        return;
      }

      // Draw real Web Audio data
      ctx.clearRect(0, 0, w, h);

      if (visualizerType === 'bars') {
        const bufferLength = localAnalyser.frequencyBinCount;
        const totalBars = 36;
        const barWidth = (w / totalBars);
        const gap = 3;
        const groupSize = Math.floor(bufferLength / totalBars);

        for (let i = 0; i < totalBars; i++) {
          let valueSum = 0;
          for (let j = 0; j < groupSize; j++) {
            valueSum += dataArray[i * groupSize + j] || 0;
          }
          const val = valueSum / groupSize;
          const barHeight = Math.max(4, (val / 255) * h * 0.95);
          const x = i * (barWidth + gap);
          const y = h - barHeight;

          // Gradient fill
          const gradient = ctx.createLinearGradient(x, y, x, h);
          gradient.addColorStop(0, gradColors[0]);
          gradient.addColorStop(1, gradColors[1]);

          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth - gap, barHeight, [4, 4, 0, 0]);
          ctx.fill();
        }
      } else if (visualizerType === 'wave') {
        ctx.lineWidth = 3;
        ctx.shadowBlur = 12;
        ctx.shadowColor = gradColors[0];

        ctx.beginPath();
        const bufferLength = dataArray.length;
        const sliceWidth = w / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * h) / 2;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);

          x += sliceWidth;
        }

        ctx.lineTo(w, h / 2);

        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, gradColors[0]);
        gradient.addColorStop(1, gradColors[1]);
        ctx.strokeStyle = gradient;

        ctx.stroke();
        ctx.shadowBlur = 0; // Reset
      } else if (visualizerType === 'circle') {
        const centerX = w / 2;
        const centerY = h / 2;
        
        let totalVal = 0;
        const numPoints = Math.min(80, dataArray.length);
        for (let i = 0; i < numPoints; i++) {
          totalVal += dataArray[i];
        }
        const avgVal = totalVal / numPoints;
        const baseRadius = Math.min(w, h) * 0.22;
        const pulse = (avgVal / 255) * 20;
        const radius = baseRadius + pulse;

        ctx.shadowBlur = 15;
        ctx.shadowColor = gradColors[0];

        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * Math.PI * 2;
          const val = dataArray[i];
          const length = Math.max(3, (val / 255) * 55);

          const x1 = centerX + Math.cos(angle) * radius;
          const y1 = centerY + Math.sin(angle) * radius;
          const x2 = centerX + Math.cos(angle) * (radius + length);
          const y2 = centerY + Math.sin(angle) * (radius + length);

          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, gradColors[0]);
          gradient.addColorStop(1, gradColors[1]);

          ctx.strokeStyle = gradient;
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // Inner circle overlay
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(10, 10, 10, 0.65)';
        ctx.strokeStyle = gradColors[0];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [visualizerType, colorMode, customColor, customColorSecondary, dominantColor, isPlaying, isEmbedMode, extractedColor, extractedGradientColors]);

  return (
    <div style={{ position: 'relative', width, height, background: 'rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Canvas */}
      <canvas ref={canvasRef} style={{ flex: 1, width: '100%', height: '100%', display: 'block' }} />

      {/* Visualizer Settings Control Toggle */}
      <button 
        onClick={() => setShowSettings(!showSettings)}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(255, 255, 255, 0.1)',
          border: 'none',
          borderRadius: '50%',
          width: 38,
          height: 38,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
        }}
        title="Opciones de visualizador"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
        </svg>
      </button>

      {/* Settings Popover */}
      {showSettings && (
        <div style={{
          position: 'absolute',
          top: 64,
          right: 16,
          background: 'rgba(15, 15, 15, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: 16,
          width: 250,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          zIndex: 20,
          color: '#fff',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(10px)',
        }}>
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 8 }}>Configuración Visual</h4>

          {/* Visualizer Type */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Estilo Visual</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {(['bars', 'wave', 'circle'] as VisualizerType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setVisualizerType(type)}
                  style={{
                    padding: '6px 0',
                    fontSize: 11,
                    borderRadius: 8,
                    border: 'none',
                    background: visualizerType === type ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                    color: '#fff',
                    fontWeight: visualizerType === type ? 700 : 500,
                    cursor: 'pointer',
                    textTransform: 'capitalize'
                  }}
                >
                  {type === 'bars' ? 'Barras' : type === 'wave' ? 'Onda' : 'Círculo'}
                </button>
              ))}
            </div>
          </div>

          {/* Color Mode */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Color</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <button
                onClick={() => setColorMode(prev => {
                  if (prev === 'cover') return 'gradient';
                  if (prev === 'gradient') return 'white';
                  if (prev === 'white') return 'custom';
                  return 'cover';
                })}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  fontSize: 12,
                  borderRadius: 20,
                  border: 'none',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                {colorMode === 'cover' ? 'Auto Sólido' : colorMode === 'gradient' ? 'Auto Gradiente' : colorMode === 'white' ? 'Blanco' : 'Manual'}
              </button>
              
              {colorMode === 'custom' && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={customColor}
                    onChange={e => setCustomColor(e.target.value)}
                    style={{
                      width: 28,
                      height: 28,
                      border: 'none',
                      borderRadius: '50%',
                      padding: 0,
                      cursor: 'pointer',
                      backgroundColor: 'transparent'
                    }}
                    title="Color primario"
                  />
                  <input
                    type="color"
                    value={customColorSecondary}
                    onChange={e => setCustomColorSecondary(e.target.value)}
                    style={{
                      width: 28,
                      height: 28,
                      border: 'none',
                      borderRadius: '50%',
                      padding: 0,
                      cursor: 'pointer',
                      backgroundColor: 'transparent'
                    }}
                    title="Color secundario"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
