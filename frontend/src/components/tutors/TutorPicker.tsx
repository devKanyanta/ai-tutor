import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap, Plus, Trash2, WifiOff } from 'lucide-react';
import { Logo } from '../Logo';
import { Link, navigate } from '../../router';
import { api } from '../../services/api';
import { UserMenu } from '../auth/UserMenu';
import { useAuth } from '../auth/AuthContext';
import { CreateTutor } from '../trial/CreateTutor';
import { TrialNotice } from '../trial/TrialNotice';
import type { Tutor, TrialStatus } from '../../types';

/** The student's first step: choose which specialised tutor to learn with. */
export const TutorPicker: React.FC = () => {
  const { user } = useAuth();
  const [tutors, setTutors] = useState<Tutor[] | null>(null);
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError(false);
    try {
      const data = await api.getTutors();
      setTutors(data.tutors);
      setTrial(data.trial);
    } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (tutor: Tutor) => {
    if (!confirm(`Delete "${tutor.name}"? Its course file and your progress with it will be removed.`)) return;
    try {
      await api.deleteTrialTutor(tutor.id);
      setNotice('');
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not delete the tutor.');
    }
  };

  const mine = tutors?.filter((t) => t.owned).length ?? 0;
  const atLimit = !!trial && mine >= trial.limits.max_tutors;

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-8">
          <Logo />
          <div className="flex items-center gap-2">
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
        <h1 className="text-3xl text-ink-900 sm:text-4xl">{user ? `Welcome, ${user.name.split(' ')[0]}.` : 'Welcome.'} Who would you like to learn with?</h1>
        <p className="mt-2 max-w-2xl text-ink-600">
          Make a tutor from your own course notes, or pick one you already have. Each tutor teaches from one course file only, so subjects never get mixed. Your lesson starts right where you left off.
        </p>
        <div className="mt-6 max-w-2xl"><TrialNotice trial={trial} /></div>
        {notice && <p role="alert" className="mt-4 max-w-2xl rounded-md bg-clay-50 px-3 py-2 text-sm text-clay-700">{notice}</p>}

        {!creating && (
          <div className="mt-6">
            <button onClick={() => setCreating(true)} disabled={atLimit || !tutors} className="btn btn-primary">
              <Plus className="h-4 w-4" /> Create a tutor from my notes
            </button>
            {atLimit && trial && <p className="mt-2 text-xs text-ink-500">The trial allows {trial.limits.max_tutors} tutors. Delete one to make another.</p>}
          </div>
        )}
        {creating && (
          <CreateTutor
            trial={trial}
            onCancel={() => setCreating(false)}
            onCreated={(id) => { setCreating(false); navigate(`/learn?tutor=${encodeURIComponent(id)}`); }}
          />
        )}

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
            <p className="mt-1 max-w-sm text-sm text-ink-500">Upload one course file and your tutor will start teaching it, lesson by lesson.</p>
          </div>
        )}

        {tutors && tutors.length > 0 && (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tutors.map((tutor, i) => {
              const ready = tutor.ready_documents > 0 && tutor.lesson_count > 0;
              const finished = tutor.lesson_count > 0 && tutor.completed_lessons >= tutor.lesson_count;
              const percent = tutor.progress_percent;
              const started = tutor.completed_lessons > 0 || percent > 0;
              const body = (
                <>
                  <span className="flex h-11 w-11 items-center justify-center rounded-md bg-board-800 font-serif text-lg font-bold text-[#f5efe4]">
                    {tutor.name.trim().charAt(0).toUpperCase() || 'T'}
                  </span>
                  <h2 className="mt-4 font-serif text-xl font-semibold text-ink-900">{tutor.name}</h2>
                  {tutor.subject && <p className="mt-0.5 text-sm font-medium text-board-600">{tutor.subject}</p>}
                  {tutor.description && <p className="mt-2 line-clamp-3 text-sm text-ink-600">{tutor.description}</p>}
                  <div className="mt-auto pt-5">
                    {ready && (
                      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress">
                        <div className="h-full rounded-full bg-board-600" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    <p className="flex items-center justify-between gap-2 text-xs font-medium text-ink-500">
                      <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />
                        {ready ? `${percent}% complete · ${tutor.completed_lessons} of ${tutor.lesson_count} lessons done` : 'Materials coming soon'}
                      </span>
                      {ready && <span className="flex items-center gap-1 text-board-700">{finished ? 'Review' : started ? 'Continue' : 'Start'} <ArrowRight className="h-3.5 w-3.5" /></span>}
                    </p>
                  </div>
                </>
              );
              const cls = 'card anim-fade-up flex h-full flex-col p-5 text-left';
              return (
                <li key={tutor.id} style={{ animationDelay: `${i * 60}ms` }} className="relative">
                  {ready ? (
                    <Link to={`/learn?tutor=${encodeURIComponent(tutor.id)}`} className={`${cls} transition-shadow hover:shadow-md`}>{body}</Link>
                  ) : (
                    <div className={`${cls} opacity-70`} aria-disabled="true">{body}</div>
                  )}
                  {tutor.owned && (
                    <button onClick={() => void remove(tutor)} className="absolute right-3 top-3 rounded-md p-1.5 text-ink-400 hover:bg-clay-50 hover:text-clay-700" title="Delete this tutor" aria-label={`Delete ${tutor.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
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
