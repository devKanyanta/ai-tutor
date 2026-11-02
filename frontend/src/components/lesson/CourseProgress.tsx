import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Circle, PlayCircle } from 'lucide-react';
import type { CourseState } from '../../types';

/** Where the student is in the tutor's course: "Lesson 3 of 8", with the full outline on click. */
export const CourseProgress: React.FC<{ course?: CourseState | null }> = ({ course }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick); };
  }, [open]);

  if (!course || course.total === 0) return null;
  const percent = Math.round((course.completed / course.total) * 100);
  const label = course.current_position ? `Lesson ${course.current_position} of ${course.total}` : `${course.completed} of ${course.total} done`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50"
        title={`${course.completed} of ${course.total} lessons completed`}
      >
        <span className="whitespace-nowrap">{label}</span>
        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-ink-100 sm:block" aria-hidden="true">
          <span className="block h-full rounded-full bg-board-600 transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </span>
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <div className="anim-rise absolute left-0 top-full z-30 mt-2 w-72 rounded-lg border border-ink-200 bg-surface p-2 shadow-lg" role="dialog" aria-label="Course outline">
          <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{course.completed} of {course.total} lessons completed</p>
          <ol className="max-h-72 overflow-y-auto">
            {course.lessons.map((l) => {
              const current = l.id === course.current_id;
              return (
                <li key={l.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-sm ${current ? 'bg-board-50 font-semibold text-board-800' : 'text-ink-700'}`} aria-current={current ? 'step' : undefined}>
                  {l.status === 'completed' ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-600" aria-label="Completed" />
                    : current ? <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-board-700" aria-label="In progress" />
                      : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" aria-label="Not started" />}
                  <span>{l.position}. {l.title}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
};
