import { useEffect, useRef, useState } from 'react';
import { Check, ListChecks, RefreshCw } from 'lucide-react';
import type { LessonPhase, LessonState } from '../../types';

const DEFAULT_PHASES: LessonPhase[] = (['WARMUP', 'LEARN', 'PRACTICE', 'RECAP'] as const).map((id, i) => ({
  id, label: ['Warm-up', 'Learn', 'Practice', 'Recap'][i], status: 'upcoming', step: 0, steps: 0, items: [],
}));

interface Props {
  lesson: LessonState;
  busy: boolean;
  onNewTopic: () => void;
}

export const LessonProgress: React.FC<Props> = ({ lesson, busy, onNewTopic }) => {
  const phases = lesson.phases && lesson.phases.length > 0 ? lesson.phases : DEFAULT_PHASES;
  const hasPlan = !!lesson.phases && lesson.phases.length > 0;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [open]);

  const current = phases.find((p) => p.status === 'current');

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <ol className="flex items-center gap-1 overflow-x-auto text-xs" aria-label={`Lesson progress: ${lesson.complete ? 'complete' : current?.label ?? 'not started'}`}>
        {phases.map((p, i) => (
          <li key={p.id} className="flex shrink-0 items-center gap-1" aria-current={p.status === 'current' ? 'step' : undefined}>
            <span className={`whitespace-nowrap rounded px-2 py-1 font-medium transition-colors duration-500 ${
              p.status === 'current' ? 'bg-board-800 text-[#f6f2e9]' : p.status === 'done' ? 'text-board-600' : 'text-ink-400'
            }`}>
              {p.status === 'done' && <Check className="mr-1 inline h-3 w-3" aria-hidden="true" />}
              {p.label}
              {p.status === 'current' && p.steps > 1 && <span className="ml-1 opacity-80">{p.step}/{p.steps}</span>}
            </span>
            {i < phases.length - 1 && <span className={`h-px w-4 transition-colors duration-500 ${p.status === 'done' ? 'bg-board-400' : 'bg-ink-200'}`} aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-ink-300 px-2 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100"
      >
        <ListChecks className="h-3.5 w-3.5" /> Plan
      </button>

      {open && (
        <div role="dialog" aria-label="Lesson plan" className="anim-rise absolute left-0 top-full z-50 mt-2 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-ink-200 bg-surface p-5 shadow-xl">
          {hasPlan ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Today’s lesson</p>
              <h2 className="mt-1 text-xl text-ink-900">{lesson.current_topic}</h2>
              {lesson.objective && <p className="mt-1 text-sm text-ink-600">{lesson.objective}</p>}
              <ol className="mt-4 space-y-4">
                {phases.map((p) => (
                  <li key={p.id}>
                    <p className={`flex items-center gap-2 text-sm font-semibold ${p.status === 'upcoming' ? 'text-ink-400' : 'text-ink-900'}`}>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                        p.status === 'done' ? 'bg-board-600 text-white' : p.status === 'current' ? 'bg-mark-300 text-ink-900' : 'bg-ink-100 text-ink-400'
                      }`}>{p.status === 'done' ? <Check className="h-3 w-3" /> : phases.indexOf(p) + 1}</span>
                      {p.label}
                      {p.status === 'current' && <span className="text-xs font-normal text-ink-500">now</span>}
                    </p>
                    <ul className="ml-7 mt-1.5 space-y-1">
                      {p.items.map((item, idx) => {
                        const doneItem = p.status === 'done' || (p.status === 'current' && p.id !== 'WARMUP' && p.id !== 'RECAP' && idx < p.step - 1);
                        const nowItem = p.status === 'current' && (p.id === 'WARMUP' || p.id === 'RECAP' || idx === p.step - 1);
                        return (
                          <li key={idx} className={`text-[13px] leading-snug ${nowItem ? 'font-medium text-ink-900' : doneItem ? 'text-ink-400' : 'text-ink-500'}`}>
                            {item}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ol>
              <button onClick={() => { setOpen(false); onNewTopic(); }} disabled={busy} className="btn btn-ghost mt-5 w-full !py-2 text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> Start a new topic
              </button>
            </>
          ) : (
            <p className="text-sm text-ink-600">
              Ask about anything in your course and the tutor will plan a short lesson here: a warm-up, the key ideas, some practice and a recap. It moves through the steps for you.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
