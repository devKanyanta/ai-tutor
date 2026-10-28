import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ThumbsDown, ThumbsUp, ArrowUpRight, FileText } from 'lucide-react';
import type { Message } from '../../types';
import { MarkdownBoard } from './MarkdownBoard';
import { toSlides } from './slides';

interface SlideDeckProps {
  turns: Message[];            // tutor turns only, oldest first
  streaming: boolean;          // the latest turn is still arriving
  thinking: boolean;           // waiting for the first words
  followLive: boolean;         // jump to the newest slide as it appears (voice)
  starters: { title: string; text: string }[];
  disabled: boolean;
  onAsk: (text: string) => void;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
}

const QUICK = [
  ['Simpler', 'Explain that more simply'],
  ['Example', 'Give me an example'],
  ['Quiz me', 'Quiz me on this'],
];

const sizeFor = (text: string) => {
  const n = text.length;
  if (n < 110) return 'text-[1.7rem] sm:text-[2.4rem] leading-[1.28]';
  if (n < 200) return 'text-[1.35rem] sm:text-[1.9rem] leading-[1.38]';
  return 'text-[1.1rem] sm:text-[1.5rem] leading-[1.5]';
};

export const SlideDeck: React.FC<SlideDeckProps> = ({
  turns, streaming, thinking, followLive, starters, disabled, onAsk, onFeedback,
}) => {
  // Navigation resets automatically whenever a new tutor turn arrives.
  const [nav, setNav] = useState<{ turnCount: number; turn: number | null; slide: number | null; dir: 'next' | 'prev' }>(
    { turnCount: 0, turn: null, slide: null, dir: 'next' },
  );
  const [showSources, setShowSources] = useState(false);
  const touchX = useRef<number | null>(null);

  const fresh = nav.turnCount === turns.length;
  const latest = turns.length - 1;
  const turnIdx = fresh && nav.turn !== null ? nav.turn : latest;
  const turn = turns[turnIdx];
  const slides = useMemo(() => (turn ? toSlides(turn.content) : []), [turn]);
  const isLive = streaming && turnIdx === latest;
  const autoIdx = isLive && followLive ? Math.max(0, slides.length - 1) : 0;
  const slideIdx = Math.min(Math.max(fresh && nav.slide !== null ? nav.slide : autoIdx, 0), Math.max(0, slides.length - 1));

  const go = (delta: number) => {
    const next = slideIdx + delta;
    if (next < 0 || next >= slides.length) return;
    setNav({ turnCount: turns.length, turn: fresh ? nav.turn : null, slide: next, dir: delta > 0 ? 'next' : 'prev' });
  };
  const goTurn = (delta: number) => {
    const next = turnIdx + delta;
    if (next < 0 || next > latest) return;
    setNav({ turnCount: turns.length, turn: next, slide: 0, dir: delta > 0 ? 'next' : 'prev' });
    setShowSources(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slide = slides[slideIdx];
  const sourceNames = turn ? Array.from(new Set((turn.sources ?? []).map((s) => s.filename))) : [];
  const settled = turn && !isLive && !turn.id.startsWith('voice-assistant-');

  return (
    <section
      className="on-dark relative flex h-full min-h-0 flex-col bg-board-900 text-[#f1ece0]"
      aria-label="Lesson board"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="pointer-events-none absolute inset-3 rounded-lg border border-white/10 sm:inset-5" aria-hidden="true" />

      {/* Header */}
      <div className="relative flex shrink-0 items-center justify-between px-7 pb-1 pt-6 text-xs text-[#c9c3b3] sm:px-12 sm:pt-9">
        <div className="flex items-center gap-1">
          {turn ? (
            <>
              <button onClick={() => goTurn(-1)} disabled={turnIdx === 0} className="rounded p-1 hover:bg-white/10 disabled:opacity-30" aria-label="Previous explanation">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">Explanation {turnIdx + 1} of {turns.length}</span>
              <button onClick={() => goTurn(1)} disabled={turnIdx === latest} className="rounded p-1 hover:bg-white/10 disabled:opacity-30" aria-label="Next explanation">
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          ) : (
            <span className="uppercase tracking-[0.14em]">Lesson board</span>
          )}
        </div>
        {slides.length > 0 && <span className="tabular-nums">Slide {slideIdx + 1} / {slides.length}{isLive ? ' · live' : ''}</span>}
      </div>

      {/* Stage */}
      <div className="board-scroll relative flex min-h-0 flex-1 items-center overflow-y-auto px-8 py-4 sm:px-16 lg:px-24" aria-live="polite">
        {!turn && !thinking && (
          <div className="anim-fade-in mx-auto w-full max-w-2xl">
            <h2 className="text-3xl font-semibold text-white sm:text-5xl">What shall we study today?</h2>
            <p className="mt-4 max-w-lg text-base text-[#c9c3b3]">
              Start a voice lesson, or type a question. Explanations appear here one idea at a time, taken from your course materials.
            </p>
            <ul className="mt-8 divide-y divide-white/10 border-y border-white/10">
              {starters.map((s) => (
                <li key={s.title}>
                  <button
                    disabled={disabled}
                    onClick={() => onAsk(s.text)}
                    className="group flex w-full items-center justify-between gap-4 py-3.5 text-left transition-colors hover:text-mark-300 disabled:opacity-50"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-white group-hover:text-mark-300">{s.title}</span>
                      <span className="block text-sm text-[#c9c3b3]">{s.text}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {thinking && !turn?.content && (
          <div className="mx-auto flex items-center gap-3 text-[#c9c3b3]" role="status">
            <span className="dot-pulse flex gap-1.5" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-mark-300" /><span className="h-2 w-2 rounded-full bg-mark-300" /><span className="h-2 w-2 rounded-full bg-mark-300" />
            </span>
            Preparing the next idea
          </div>
        )}

        {slide && (
          <div
            key={`${turnIdx}-${slideIdx}-${slide.startsWith('```') ? 'c' : ''}`}
            className={`mx-auto w-full max-w-3xl ${nav.dir === 'next' ? 'anim-slide-next' : 'anim-slide-prev'} ${isLive && slideIdx === slides.length - 1 ? 'caret-host' : ''}`}
          >
            <div className={`font-serif ${sizeFor(slide)} ${isLive && slideIdx === slides.length - 1 ? 'caret' : ''}`}>
              <MarkdownBoard content={slide} />
            </div>
          </div>
        )}
      </div>

      {showSources && turn && (
        <div className="board-scroll anim-rise relative mx-7 mb-2 max-h-40 shrink-0 space-y-2 overflow-y-auto rounded-lg bg-black/25 p-3 text-xs text-[#d8d2c2] sm:mx-12">
          {(turn.sources ?? []).map((s, i) => (
            <p key={i}><span className="font-semibold text-white">{s.filename}, section {s.chunk_index + 1}.</span> “{s.snippet}”</p>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="relative shrink-0 space-y-3 px-7 pb-7 pt-2 sm:px-12 sm:pb-10">
        {slides.length > 1 && (
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => go(-1)} disabled={slideIdx === 0} className="rounded-full border border-white/20 p-2 transition-colors hover:bg-white/10 disabled:opacity-25" aria-label="Previous slide">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
              {slides.map((_, i) => (
                <button
                  key={i}
                  role="tab"
                  aria-selected={i === slideIdx}
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setNav({ turnCount: turns.length, turn: fresh ? nav.turn : null, slide: i, dir: i >= slideIdx ? 'next' : 'prev' })}
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === slideIdx ? 'w-6 bg-mark-300' : 'w-1.5 bg-white/30 hover:bg-white/60'}`}
                />
              ))}
            </div>
            <button onClick={() => go(1)} disabled={slideIdx === slides.length - 1} className="rounded-full border border-white/20 p-2 transition-colors hover:bg-white/10 disabled:opacity-25" aria-label="Next slide">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {turn && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {sourceNames.length > 0 && !isLive && (
                <button
                  onClick={() => setShowSources((v) => !v)}
                  aria-expanded={showSources}
                  className="inline-flex max-w-full items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-[#d8d2c2] transition-colors hover:bg-white/10"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Source: {sourceNames[0]}{sourceNames.length > 1 ? ` +${sourceNames.length - 1}` : ''}</span>
                </button>
              )}
              {!isLive && turnIdx === latest && QUICK.map(([label, text]) => (
                <button key={label} disabled={disabled} onClick={() => onAsk(text)} className="rounded border border-white/20 px-2 py-1 text-[#d8d2c2] transition-colors hover:bg-white/10 disabled:opacity-40">
                  {label}
                </button>
              ))}
            </div>
            {settled && (
              <div className="flex items-center gap-1">
                <button onClick={() => onFeedback(turn.id, 1)} aria-pressed={turn.feedback === 1} aria-label="This helped" className={`rounded p-1.5 transition-colors hover:bg-white/10 ${turn.feedback === 1 ? 'text-mark-300' : 'text-[#c9c3b3]'}`}>
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button onClick={() => onFeedback(turn.id, -1)} aria-pressed={turn.feedback === -1} aria-label="This was unclear" className={`rounded p-1.5 transition-colors hover:bg-white/10 ${turn.feedback === -1 ? 'text-mark-300' : 'text-[#c9c3b3]'}`}>
                  <ThumbsDown className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
