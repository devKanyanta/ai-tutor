import { useEffect, useRef, useState } from 'react';
import { VoiceOrb } from '../lesson/VoiceOrb';
import type { VoiceLevels } from '../lesson/useVoiceLesson';

const SCRIPT = [
  { slide: 'Plants don’t eat soil. So where does a tree’s mass actually come from?', who: 'tutor' as const },
  { slide: 'Most of it is carbon, pulled from the air as carbon dioxide and built into sugars using light.', who: 'tutor' as const },
  { slide: 'Before I go on: what do you think happens to the oxygen?', who: 'tutor' as const },
  { slide: '', who: 'you' as const, said: 'Does the plant breathe it out?' },
];

/** A scripted preview of the lesson screen for the landing page (no network, no mic). */
export const DemoLesson: React.FC = () => {
  const levels = useRef<VoiceLevels>({ mic: 0, tutor: 0 });
  const [step, setStep] = useState(0);
  const [said, setSaid] = useState('');

  useEffect(() => {
    const pulse = window.setInterval(() => {
      const who = SCRIPT[step].who;
      const v = 0.25 + Math.random() * 0.6;
      levels.current = who === 'tutor' ? { mic: 0, tutor: v } : { mic: v, tutor: 0 };
    }, 110);
    const next = window.setTimeout(() => {
      const n = (step + 1) % SCRIPT.length;
      setStep(n);
      if (n === 0) setSaid('');
      if (SCRIPT[n].who === 'you') setSaid(SCRIPT[n].said ?? '');
    }, SCRIPT[step].who === 'you' ? 3200 : 4200);
    return () => { window.clearInterval(pulse); window.clearTimeout(next); };
  }, [step]);

  const current = SCRIPT[step];
  const slideStep = current.who === 'tutor' ? step : 2;
  const status = current.who === 'tutor' ? 'Tutor is speaking' : 'Listening to you';

  return (
    <div className="overflow-hidden rounded-xl border border-ink-300 bg-surface shadow-[0_24px_60px_-24px_rgba(20,43,35,0.35)]" aria-label="Example lesson" role="img">
      <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2.5 text-[11px] text-ink-500">
        <span className="font-serif text-sm font-semibold text-ink-800">Socratic</span>
        <span className="rounded bg-board-800 px-2 py-0.5 font-medium text-[#f6f2e9]">Learn</span>
      </div>
      <div className="grid sm:grid-cols-[1fr_13.5rem]">
        <div className="on-dark relative min-h-[15rem] bg-board-900 p-6 sm:min-h-[19rem] sm:p-8">
          <div className="pointer-events-none absolute inset-2.5 rounded border border-white/10" />
          <p className="relative text-[11px] uppercase tracking-[0.14em] text-[#c9c3b3]">Slide {slideStep + 1} / 3</p>
          <p key={slideStep} className="anim-fade-in relative mt-5 font-serif text-[1.35rem] leading-snug text-[#f1ece0] sm:text-[1.6rem]">
            {SCRIPT[slideStep].slide.split(/(carbon dioxide|oxygen)/).map((part, i) =>
              /^(carbon dioxide|oxygen)$/.test(part) ? <strong key={i} className="font-semibold text-mark-300">{part}</strong> : part)}
          </p>
          <div className="absolute bottom-4 left-8 flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === slideStep ? 'w-6 bg-mark-300' : 'w-1.5 bg-white/30'}`} />)}
          </div>
        </div>
        <div className="flex flex-col items-center border-t border-ink-200 p-5 sm:border-l sm:border-t-0">
          <VoiceOrb levelsRef={levels} mode="live" className="aspect-square w-36" />
          <p className="mt-2 text-xs font-semibold text-ink-800">{status}</p>
          <div className="mt-4 w-full border-t border-ink-100 pt-3">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">You said</p>
            <p className={`min-h-[3rem] border-l-2 pl-2.5 font-serif text-[0.95rem] leading-snug transition-opacity duration-500 ${said ? 'border-clay-500 text-ink-900 opacity-100' : 'border-transparent opacity-0'}`}>{said || ' '}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
