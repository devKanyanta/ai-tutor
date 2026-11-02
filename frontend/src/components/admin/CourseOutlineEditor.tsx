import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ListOrdered, Loader2 } from 'lucide-react';
import { api, UNAUTHORIZED } from '../../services/api';
import type { CourseLesson } from '../../types';

interface Props {
  token: string;
  tutorId: string;
  /** Changes whenever the tutor's documents change, so the outline is rebuilt. */
  refreshKey: string;
  onUnauthorized: () => void;
}

/** The lessons students work through, in order. Built from the documents; rename and reorder here. */
export const CourseOutlineEditor: React.FC<Props> = ({ token, tutorId, refreshKey, onUnauthorized }) => {
  const [lessons, setLessons] = useState<CourseLesson[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLessons(await api.getTutorLessons(token, tutorId));
      setDirty(false);
    } catch (err) {
      if (err instanceof Error && err.message === UNAUTHORIZED) onUnauthorized();
    }
  }, [token, tutorId, onUnauthorized]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load, refreshKey]);

  const move = (index: number, by: -1 | 1) => {
    setLessons((prev) => {
      const next = [...prev];
      const target = index + by;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
    setSaved(false);
  };

  const rename = (index: number, title: string) => {
    setLessons((prev) => prev.map((l, i) => (i === index ? { ...l, title } : l)));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      setLessons(await api.saveTutorLessons(token, tutorId, lessons.map((l) => ({ id: l.id, title: l.title.trim() || 'Untitled lesson' }))));
      setDirty(false);
      setSaved(true);
    } catch (err) {
      if (err instanceof Error && err.message === UNAUTHORIZED) onUnauthorized();
      else setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Course outline" className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl font-semibold text-ink-900">
          Course outline <span className="ml-1 rounded-full bg-ink-100 px-2 py-0.5 font-sans text-xs font-semibold text-ink-600">{lessons.length}</span>
        </h2>
        <div className="flex items-center gap-3">
          {saved && !dirty && <span className="flex items-center gap-1 text-sm text-board-700"><Check className="h-4 w-4" /> Saved</span>}
          {error && <span role="alert" className="text-sm text-clay-700">{error}</span>}
          <button onClick={() => void save()} disabled={!dirty || saving} className="btn btn-primary !py-2 text-sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save order'}
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-ink-500">
        Students start at lesson 1 and are taken through the course in this order. Each document becomes a lesson; long documents are split into parts.
      </p>
      {lessons.length === 0 ? (
        <div className="card flex items-center gap-3 px-5 py-6 text-sm text-ink-500">
          <ListOrdered className="h-5 w-5 shrink-0 text-ink-400" /> Lessons appear here once a document has finished indexing.
        </div>
      ) : (
        <ol className="card divide-y divide-ink-100">
          {lessons.map((lesson, i) => (
            <li key={lesson.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-ink-400">{i + 1}</span>
              <input
                value={lesson.title}
                maxLength={120}
                onChange={(e) => rename(i, e.target.value)}
                aria-label={`Title of lesson ${i + 1}`}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-ink-900 hover:border-ink-200 focus:border-board-500 focus:bg-white focus:outline-none"
              />
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" aria-label={`Move lesson ${i + 1} up`}><ArrowUp className="h-4 w-4" /></button>
              <button onClick={() => move(i, 1)} disabled={i === lessons.length - 1} className="rounded p-1.5 text-ink-500 hover:bg-ink-100 disabled:opacity-30" aria-label={`Move lesson ${i + 1} down`}><ArrowDown className="h-4 w-4" /></button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
