import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, WifiOff } from 'lucide-react';
import { Logo } from '../Logo';
import { Link } from '../../router';
import { api } from '../../services/api';
import type { Tutor } from '../../types';

/** The student's first step: choose which specialised tutor to learn with. */
export const TutorPicker: React.FC = () => {
  const [tutors, setTutors] = useState<Tutor[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try { setTutors(await api.getTutors()); } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-8">
          <Logo />
          <Link to="/studio" className="px-2 py-2 text-xs font-medium text-ink-600 hover:text-ink-900">Instructors</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl text-ink-900 sm:text-4xl">Who would you like to learn with?</h1>
        <p className="mt-2 max-w-2xl text-ink-600">
          Each tutor is built by an instructor around one course or subject and teaches only from that course’s materials.
        </p>

        {error && (
          <div role="alert" className="mt-8 flex items-center justify-between gap-3 rounded-lg border border-mark-400/50 bg-mark-300/30 px-4 py-3 text-sm text-ink-800">
            <span className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> We can’t load the tutors right now.</span>
            <button onClick={() => void load()} className="btn btn-ghost !py-1.5 text-xs">Try again</button>
          </div>
        )}

        {!tutors && !error && (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-lg" />)}
          </div>
        )}

        {tutors && tutors.length === 0 && (
          <div className="card mt-8 flex flex-col items-center px-6 py-14 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-ink-50 text-ink-400"><GraduationCap className="h-7 w-7" /></span>
            <p className="font-serif text-lg font-semibold text-ink-900">No tutors yet</p>
            <p className="mt-1 max-w-sm text-sm text-ink-500">An instructor needs to create a tutor and add course materials first.</p>
            <Link to="/studio" className="btn btn-primary mt-5">Open the instructor studio</Link>
          </div>
        )}

        {tutors && tutors.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tutors.map((tutor, i) => {
              const ready = tutor.ready_documents > 0;
              const body = (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-md bg-board-800 font-serif text-lg font-bold text-[#f6f2e9]">
                    {tutor.name.trim().charAt(0).toUpperCase() || 'T'}
                  </span>
                  <h2 className="mt-4 font-serif text-xl font-semibold text-ink-900">{tutor.name}</h2>
                  {tutor.subject && <p className="mt-0.5 text-sm font-medium text-board-600">{tutor.subject}</p>}
                  {tutor.description && <p className="mt-2 line-clamp-3 text-sm text-ink-600">{tutor.description}</p>}
                  <p className="mt-auto flex items-center justify-between gap-2 pt-5 text-xs font-medium text-ink-500">
                    <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />
                      {ready ? `${tutor.ready_documents} ${tutor.ready_documents === 1 ? 'document' : 'documents'}` : 'Materials coming soon'}
                    </span>
                    {ready && <span className="flex items-center gap-1 text-board-700">Start <ArrowRight className="h-3.5 w-3.5" /></span>}
                  </p>
                </>
              );
              const cls = 'card anim-fade-up flex h-full flex-col p-5 text-left';
              return (
                <li key={tutor.id} style={{ animationDelay: `${i * 60}ms` }}>
                  {ready ? (
                    <Link to={`/learn?tutor=${encodeURIComponent(tutor.id)}`} className={`${cls} transition-shadow hover:shadow-md`}>{body}</Link>
                  ) : (
                    <div className={`${cls} opacity-70`} aria-disabled="true">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
};
