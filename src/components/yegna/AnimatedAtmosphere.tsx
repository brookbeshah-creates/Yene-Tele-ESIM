import React, { useEffect, useRef } from 'react';
import { useTheme } from '../../contexts/ThemeContext';

interface AnimatedAtmosphereProps {
  variant?: 'hero' | 'subtle';
  className?: string;
}

type SimTone = 'green' | 'blue' | 'yellow';

interface FloatingSimCard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  va: number;
  alpha: number;
  tone: SimTone;
}

const SIM_PALETTE_LIGHT: Record<SimTone, { fill: string; stroke: string; chip: string }> = {
  green: {
    fill: '220, 252, 231', // #DCFCE7 light green
    stroke: '52, 168, 83', // #34A853 Google green
    chip: '22, 163, 74',
  },
  blue: {
    fill: '219, 234, 254', // #DBEAFE light blue
    stroke: '66, 133, 244', // #4285F4 Google blue
    chip: '37, 99, 235',
  },
  yellow: {
    fill: '254, 249, 195', // #FEF9C3 light yellow
    stroke: '234, 179, 8', // #EAB308 Google yellow
    chip: '202, 138, 4',
  },
};

const SIM_PALETTE_DARK: Record<SimTone, { fill: string; stroke: string; chip: string }> = {
  green: {
    fill: '20, 83, 45',
    stroke: '134, 239, 172', // #86EFAC
    chip: '134, 239, 172',
  },
  blue: {
    fill: '30, 58, 138',
    stroke: '147, 197, 253', // #93C5FD
    chip: '147, 197, 253',
  },
  yellow: {
    fill: '113, 63, 18',
    stroke: '253, 224, 71', // #FDE047
    chip: '253, 224, 71',
  },
};

function drawMiniSimCard(
  ctx: CanvasRenderingContext2D,
  card: FloatingSimCard,
  isDark: boolean,
) {
  const { x, y, w, h, angle, alpha, tone } = card;
  const hw = w / 2;
  const hh = h / 2;
  const notch = w * 0.3;
  const r = Math.max(1.5, w * 0.14);

  const palette = isDark ? SIM_PALETTE_DARK[tone] : SIM_PALETTE_LIGHT[tone];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Outer notched SIM card silhouette (cut corner at top-right)
  ctx.beginPath();
  ctx.moveTo(-hw + r, -hh);
  ctx.lineTo(hw - notch, -hh);
  ctx.lineTo(hw, -hh + notch);
  ctx.lineTo(hw, hh - r);
  ctx.quadraticCurveTo(hw, hh, hw - r, hh);
  ctx.lineTo(-hw + r, hh);
  ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
  ctx.lineTo(-hw, -hh + r);
  ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  ctx.closePath();

  ctx.fillStyle = `rgba(${palette.fill}, ${(alpha * (isDark ? 0.68 : 0.96)).toFixed(3)})`;
  ctx.fill();
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = `rgba(${palette.stroke}, ${Math.min(0.95, alpha * 1.15).toFixed(3)})`;
  ctx.stroke();

  // Inner SIM contact chip pad
  const chipW = w * 0.54;
  const chipH = h * 0.36;
  const chipX = -chipW / 2;
  const chipY = -chipH / 2 + h * 0.08;
  const chipR = Math.max(1, chipW * 0.14);

  ctx.beginPath();
  ctx.roundRect(chipX, chipY, chipW, chipH, chipR);
  ctx.strokeStyle = `rgba(${palette.chip}, ${Math.min(0.9, alpha * 0.95).toFixed(3)})`;
  ctx.lineWidth = 0.95;
  ctx.stroke();

  // Contact pad grid lines
  ctx.beginPath();
  ctx.moveTo(chipX, chipY + chipH * 0.5);
  ctx.lineTo(chipX + chipW, chipY + chipH * 0.5);
  ctx.moveTo(chipX + chipW * 0.5, chipY);
  ctx.lineTo(chipX + chipW * 0.5, chipY + chipH);
  ctx.strokeStyle = `rgba(${palette.chip}, ${(alpha * 0.65).toFixed(3)})`;
  ctx.lineWidth = 0.75;
  ctx.stroke();

  ctx.restore();
}

/**
 * Lightweight atmospheric background layer.
 * - Uses smooth CSS drifting royal-blue / light-blue aura blobs
 * - Renders multi-colored floating SIM cards (light green, light blue, light yellow) at 60fps
 * - Automatically reduces complexity on mobile viewports (<768px)
 * - Respects prefers-reduced-motion: reduce (renders crisp static SIM cards)
 */
export function AnimatedAtmosphere({
  variant = 'hero',
  className = '',
}: AnimatedAtmosphereProps) {
  const { resolvedTheme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = Boolean(motionQuery?.matches);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cards: FloatingSimCard[] = [];
    const isDark = resolvedTheme === 'dark';
    const tones: SimTone[] = ['green', 'blue', 'yellow'];

    const initCards = () => {
      const isCompact = width < 768;
      const count = variant === 'hero' ? (isCompact ? 12 : 24) : isCompact ? 8 : 15;
      cards = Array.from({ length: count }, (_, idx) => {
        const w = 16 + Math.random() * 10; // small 16px–26px SIM cards
        const h = w * 1.32;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.34,
          vy: -0.15 - Math.random() * 0.25,
          w,
          h,
          angle: (Math.random() - 0.5) * 0.6,
          va: (Math.random() - 0.5) * 0.004,
          alpha: 0.42 + Math.random() * 0.26,
          tone: tones[idx % tones.length],
        };
      });
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, width, height);
      for (const card of cards) {
        drawMiniSimCard(ctx, card, isDark);
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initCards();
      if (prefersReducedMotion) {
        drawStatic();
      }
    };

    resize();
    window.addEventListener('resize', resize);

    if (prefersReducedMotion) {
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    const renderFrame = () => {
      if (document.hidden) {
        rafId = window.requestAnimationFrame(renderFrame);
        return;
      }

      ctx.clearRect(0, 0, width, height);

      for (const card of cards) {
        card.x += card.vx;
        card.y += card.vy;
        card.angle += card.va;

        if (card.x < -30) card.x = width + 30;
        if (card.x > width + 30) card.x = -30;
        if (card.y < -35) {
          card.y = height + 35;
          card.x = Math.random() * width;
        }
        if (card.y > height + 35) card.y = -35;

        drawMiniSimCard(ctx, card, isDark);
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    rafId = window.requestAnimationFrame(renderFrame);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [resolvedTheme, variant]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden select-none ${className}`}
    >
      {/* Soft drifting radial royal-blue & light-blue atmospheric depth */}
      <div
        className={`yegna-animate-orb absolute -top-28 -right-24 rounded-full blur-3xl ${
          variant === 'hero'
            ? 'h-[360px] w-[360px] sm:h-[460px] sm:w-[460px] bg-[#619ED8]/18 dark:bg-[#0A2DB8]/32'
            : 'h-[260px] w-[260px] bg-[#619ED8]/14 dark:bg-[#3B82F6]/20'
        }`}
      />
      <div
        className={`yegna-animate-orb-reverse absolute -bottom-24 -left-20 rounded-full blur-3xl ${
          variant === 'hero'
            ? 'h-[320px] w-[320px] sm:h-[420px] sm:w-[420px] bg-[#0A2DB8]/10 dark:bg-[#619ED8]/18'
            : 'h-[220px] w-[220px] bg-[#0A2DB8]/8 dark:bg-[#619ED8]/12'
        }`}
      />

      {/* Crisp subtle geometric network grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(97, 158, 216, 0.28) 1px, transparent 0)',
          backgroundSize: '36px 36px',
        }}
      />

      {/* Restrained 60fps floating small SIM cards */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
