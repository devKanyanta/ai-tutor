import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { VoiceLevels } from './useVoiceLesson';

export type OrbMode = 'idle' | 'connecting' | 'live';

interface VoiceOrbProps {
  levelsRef: RefObject<VoiceLevels>;
  mode: OrbMode;
  /** Pixel size is controlled by the parent via CSS; the canvas fills it. */
  className?: string;
}

const BARS = 72;
const CSS = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Circular voice visual: a ring of bars that responds to the real microphone level
 * (student, clay red) and to the tutor's playback level (board green).
 */
export const VoiceOrb: React.FC<VoiceOrbProps> = ({ levelsRef, mode, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colors = {
      idle: CSS('--color-ink-300', '#b9b2a0'),
      tutor: CSS('--color-board-600', '#2c5847'),
      student: CSS('--color-clay-500', '#b4472f'),
      disc: CSS('--color-board-900', '#142b23'),
      mark: CSS('--color-mark-300', '#f4d35e'),
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const amps = new Float32Array(BARS);
    let smooth = 0;
    let frame = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = (now - start) / 1000;
      const levels = levelsRef.current ?? { mic: 0, tutor: 0 };
      // Tutor level decays between audio chunks.
      levels.tutor *= 0.93;
      const live = modeRef.current === 'live';
      const tutorSpeaking = live && levels.tutor > levels.mic && levels.tutor > 0.04;
      const studentSpeaking = live && !tutorSpeaking && levels.mic > 0.06;
      const target = live ? Math.max(levels.mic * 0.9, levels.tutor) : modeRef.current === 'connecting' ? 0.18 + 0.1 * Math.sin(t * 5) : 0.05 + 0.03 * Math.sin(t * 1.4);
      smooth += (target - smooth) * 0.18;

      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const size = Math.min(width, height);
      const discR = size * 0.27;
      const baseR = size * 0.33;
      const maxLen = size * 0.15;

      const barColor = tutorSpeaking ? colors.tutor : studentSpeaking ? colors.student : live ? colors.tutor : colors.idle;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, size * 0.011);
      ctx.strokeStyle = barColor;

      for (let i = 0; i < BARS; i += 1) {
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        // Each bar follows its own phase so the ring ripples instead of pulsing uniformly.
        const wave = 0.5 + 0.5 * Math.sin(t * (reduce ? 0 : 6) + i * 0.55) * Math.cos(t * (reduce ? 0 : 2.3) + i * 0.17);
        const targetAmp = 0.12 + smooth * (0.35 + 0.65 * wave);
        amps[i] += (targetAmp - amps[i]) * 0.3;
        const len = 3 + amps[i] * maxLen * 2.2;
        const x1 = cx + Math.cos(angle) * baseR;
        const y1 = cy + Math.sin(angle) * baseR;
        const x2 = cx + Math.cos(angle) * (baseR + len);
        const y2 = cy + Math.sin(angle) * (baseR + len);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Centre disc: solid chalkboard green with a thin ring that scales with the voice.
      ctx.beginPath();
      ctx.arc(cx, cy, discR * (1 + smooth * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = colors.disc;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, discR * 0.78 * (1 + smooth * 0.14), 0, Math.PI * 2);
      ctx.strokeStyle = live ? colors.mark : 'rgb(255 255 255 / .28)';
      ctx.lineWidth = Math.max(1.5, size * 0.007);
      ctx.stroke();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [levelsRef]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
};
