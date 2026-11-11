import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ThumbsDown, ThumbsUp, ArrowUpRight, FileText } from 'lucide-react';
import type { Message } from '../../types';
import { MarkdownBoard } from './MarkdownBoard';
import { toSlides } from './slides';

interface SlideDeckProps {
  turns: Message[];            // tutor turns only, oldest first
  streaming: boolean;          // the latest turn is still arriving
  thinking: boolean;           // waiting for the first words
  thinkingLabel?: string;      // e.g. "Planning your lesson…"
  followLive: boolean;         // jump to the newest slide as it appears (voice)
  starters: { title: string; text: string }[];
  disabled: boolean;
  checkpoint?: string;         // phase the tutor is asking permission to start, e.g. "Practice"
  onAsk: (text: string) => void;
  onFeedback: (messageId: string, rating: 1 | -1) => void;
}

const QUICK = [
  ['Simpler', 'Explain that more simply'],
  ['Example', 'Give me an example'],
  ['Quiz me', 'Quiz me on this'],
];

// One steady size for prose so text never appears to change font while it streams in.
const PROSE_SIZE = 'text-[1.4rem] sm:text-[1.9rem] leading-[1.4]';
const LONG_SIZE = 'text-[1.1rem] sm:text-[1.4rem] leading-[1.5]';

export const SlideDeck: React.FC<SlideDeckProps> = ({
  turns, streaming, thinking, thinkingLabel, followLive, starters, disabled, checkpoint, onAsk, onFeedback,
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
  // Spoken turns follow the newest slide, and stay there after the tutor finishes.
  const follow = (isLive && followLive) || (!!turn?.plain && turnIdx === latest);
  const autoIdx = follow ? Math.max(0, slides.length - 1) : 0;
  const slideIdx = Math.min(Math.max(fresh && nav.slide !== null ? nav.slide : autoIdx, 0), Math.max(0, slides.length - 1));
  const showTrail = follow && slideIdx > 0 && slideIdx === slides.length - 1 && !(fresh && nav.slide !== null);
  const renderSlide = (text: string) => (turn?.plain ? <div className="md-board"><p className="whitespace-pre-wrap">{text}</p></div> : <MarkdownBoard content={text} />);

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
      className="on-dark relative flex h-full min-h-0 flex-col bg-board-900 text-[#f5efe4]"
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
      <div className="relative flex shrink-0 items-center justify-between px-7 pb-1 pt-6 text-xs text-[#c3cbdb] sm:px-12 sm:pt-9">
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
        {thinking && turn && (
          <span className="anim-fade-in flex items-center gap-2 text-mark-300" role="status">
            <span className="dot-pulse flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 rounded-full bg-mark-300" /><span className="h-1.5 w-1.5 rounded-full bg-mark-300" /><span className="h-1.5 w-1.5 rounded-full bg-mark-300" />
            </span>
            {thinkingLabel ?? 'Preparing the next idea'}
          </span>
        )}
        {slides.length > 0 && <span className="tabular-nums">Slide {slideIdx + 1} / {slides.length}{isLive ? ' · live' : ''}</span>}
      </div>

      {/* Stage */}
      <div className="board-scroll relative flex min-h-0 flex-1 items-center overflow-y-auto px-8 py-4 sm:px-16 lg:px-24" aria-live="polite">
        {!turn && !thinking && (
          <div className="anim-fade-in mx-auto w-full max-w-2xl">
            <h2 className="text-3xl font-semibold text-white sm:text-5xl">{starters.length ? 'What shall we study today?' : 'Your lesson is ready when you are'}</h2>
            <p className="mt-4 max-w-lg text-base text-[#c3cbdb]">
              {starters.length
                ? 'Start a voice lesson, or type a question. Explanations appear here one idea at a time, taken from your course materials.'
                : 'Press “Start voice lesson” to talk it through, or type below. Explanations appear here one idea at a time.'}
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
                      <span className="block text-sm text-[#c3cbdb]">{s.text}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {thinking && !turn?.content && (
          <div className="mx-auto flex items-center gap-3 text-[#c3cbdb]" role="status">
            <span className="dot-pulse flex gap-1.5" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-mark-300" /><span className="h-2 w-2 rounded-full bg-mark-300" /><span className="h-2 w-2 rounded-full bg-mark-300" />
            </span>
            {thinkingLabel ?? 'Preparing the next idea'}
          </div>
        )}

        {slide && (
          <div className="mx-auto w-full max-w-3xl">
            {showTrail && (
              <p key={`trail-${slideIdx}`} className="anim-fade-in mb-6 line-clamp-3 font-serif text-[1.05rem] leading-snug text-[#f5efe4]/45 sm:text-[1.25rem]">
                {slides[slideIdx - 1]?.replace(/[*_`#>$]/g, '')}
              </p>
            )}
            <div
              key={`${turnIdx}-${slideIdx}`}
              className={`${nav.dir === 'next' ? 'anim-slide-next' : 'anim-slide-prev'} font-serif ${slide.length > 260 ? LONG_SIZE : PROSE_SIZE} ${isLive && slideIdx === slides.length - 1 ? 'caret' : ''}`}
            >
              {renderSlide(slide)}
            </div>
          </div>
        )}
      </div>

      {showSources && turn && (
        <div className="board-scroll anim-rise relative mx-7 mb-2 max-h-40 shrink-0 space-y-2 overflow-y-auto rounded-lg bg-black/25 p-3 text-xs text-[#d5dbe7] sm:mx-12">
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
                  className="inline-flex max-w-full items-center gap-1.5 rounded border border-white/20 px-2 py-1 text-[#d5dbe7] transition-colors hover:bg-white/10"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Source: {sourceNames[0]}{sourceNames.length > 1 ? ` +${sourceNames.length - 1}` : ''}</span>
                </button>
              )}
              {!isLive && turnIdx === latest && checkpoint && (
                <>
                  <button disabled={disabled} onClick={() => onAsk("Yes, I'm ready to move on")} className="rounded bg-mark-300 px-2.5 py-1 font-semibold text-board-950 transition-colors hover:bg-mark-400 disabled:opacity-40">
                    Yes, move on to {checkpoint}
                  </button>
                  <button disabled={disabled} onClick={() => onAsk('Not yet, I would like to go over this some more')} className="rounded border border-white/20 px-2 py-1 text-[#d5dbe7] transition-colors hover:bg-white/10 disabled:opacity-40">
                    Not yet
                  </button>
                </>
              )}
              {!isLive && turnIdx === latest && !checkpoint && QUICK.map(([label, text]) => (
                <button key={label} disabled={disabled} onClick={() => onAsk(text)} className="rounded border border-white/20 px-2 py-1 text-[#d5dbe7] transition-colors hover:bg-white/10 disabled:opacity-40">
                  {label}
                </button>
              ))}
            </div>
            {settled && (
              <div className="flex items-center gap-1">
                <button onClick={() => onFeedback(turn.id, 1)} aria-pressed={turn.feedback === 1} aria-label="This helped" className={`rounded p-1.5 transition-colors hover:bg-white/10 ${turn.feedback === 1 ? 'text-mark-300' : 'text-[#c3cbdb]'}`}>
                  <ThumbsUp className="h-4 w-4" />
                </button>
                <button onClick={() => onFeedback(turn.id, -1)} aria-pressed={turn.feedback === -1} aria-label="This was unclear" className={`rounded p-1.5 transition-colors hover:bg-white/10 ${turn.feedback === -1 ? 'text-mark-300' : 'text-[#c3cbdb]'}`}>
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
