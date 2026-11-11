import { FlaskConical } from 'lucide-react';
import type { TrialStatus } from '../../types';

const minutes = (seconds: number) => Math.floor(seconds / 60);

/** Tells students this is a trial, what is left of today's allowance, and that the full version is coming. */
export const TrialNotice: React.FC<{ trial: TrialStatus | null }> = ({ trial }) => (
  <aside className="rounded-lg border border-mark-400/50 bg-mark-300/20 px-4 py-3 text-sm text-ink-800" aria-label="Free trial">
    <p className="flex items-center gap-2 font-semibold text-ink-900"><FlaskConical className="h-4 w-4" /> Free trial</p>
    <p className="mt-1 text-ink-700">
      {trial?.notice ?? 'You are using the free trial. We are still building Socratic, and we will email you when the full version is released.'}
    </p>
    {trial && (
      <p className="mt-2 text-xs text-ink-600">
        Today you have <strong>{trial.remaining.turns}</strong> of {trial.limits.daily_turns} tutor replies and{' '}
        <strong>{minutes(trial.remaining.voice_seconds)}</strong> of {trial.limits.daily_voice_minutes} voice minutes left.
        Tutors: {trial.usage.tutors} of {trial.limits.max_tutors}. Course files up to {trial.limits.max_upload_mb} MB.
      </p>
    )}
    <p className="mt-2 text-xs text-ink-600">
      Questions or feedback? <a className="font-medium underline" href="mailto:mapalokanyanta1@gmail.com">mapalokanyanta1@gmail.com</a>
      {' · '}<a className="font-medium underline" href="tel:+260765237189">0765237189</a>
      {' · '}<a className="font-medium underline" href="https://github.com/devKanyanta" target="_blank" rel="noreferrer">@devKanyanta</a>
    </p>
  </aside>
);
