const STEPS = ['Warm-up', 'Learn', 'Practice', 'Recap'];
const STAGE_INDEX: Record<string, number> = {
  INIT: 0, HOOK: 0, CONCEPT: 1, REAL_WORLD_EXAMPLE: 2, CHECK_UNDERSTANDING: 2, SYNTHESIS: 3,
};

export const LessonProgress: React.FC<{ stage: string; active: boolean }> = ({ stage, active }) => {
  const current = active ? (STAGE_INDEX[stage] ?? 0) : -1;
  return (
    <ol className="flex items-center gap-1 text-xs" aria-label={`Lesson progress: ${current >= 0 ? STEPS[current] : 'not started'}`}>
      {STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-1" aria-current={i === current ? 'step' : undefined}>
          <span className={`rounded px-2 py-1 font-medium transition-colors duration-500 ${
            i === current ? 'bg-board-800 text-[#f6f2e9]' : i < current ? 'text-board-600' : 'text-ink-400'
          }`}>
            {i < current && <span aria-hidden="true">✓ </span>}{label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-4 bg-ink-200" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
};
