import { useRef, useState } from 'react';
import { FileUp, Loader2, X } from 'lucide-react';
import { api } from '../../services/api';
import type { TrialStatus } from '../../types';

const FIELD = 'mt-1 w-full rounded-lg border border-ink-300 bg-white px-4 py-3 text-sm font-normal focus:border-board-500 focus:outline-none focus:ring-2 focus:ring-board-500/20';
const ACCEPT = '.pdf,.docx,.doc,.txt,.md,.markdown,.csv';

/** Make your own tutor from ONE course file. Different subjects get different tutors so material never mixes. */
export const CreateTutor: React.FC<{ trial: TrialStatus | null; onCreated: (tutorId: string) => void; onCancel: () => void }> = ({ trial, onCreated, onCancel }) => {
  const [subject, setSubject] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const maxMb = trial?.limits.max_upload_mb ?? 5;
  const tooBig = !!file && file.size > maxMb * 1024 * 1024;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || tooBig || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await api.createTrialTutor(subject.trim(), file);
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your tutor.');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="card anim-rise mt-8 max-w-xl p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-xl font-semibold text-ink-900">Create your Socratic tutor</h2>
          <p className="mt-1 text-sm text-ink-600">
            Upload <strong>one</strong> course file. Your tutor teaches only from it, one lesson at a time. For a different subject, make another tutor so nothing gets mixed up.
          </p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100" aria-label="Cancel"><X className="h-4 w-4" /></button>
      </div>

      <label className="mt-5 block text-sm font-medium text-ink-800">
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={120} placeholder="e.g. Cell biology" className={FIELD} />
      </label>

      <div className="mt-4">
        <p className="text-sm font-medium text-ink-800">Course material</p>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" id="trial-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <label htmlFor="trial-file" className="mt-1 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-300 bg-ink-50 px-4 py-5 text-sm text-ink-700 hover:border-board-600">
          <FileUp className="h-5 w-5 shrink-0 text-board-600" />
          <span className="min-w-0 truncate">{file ? file.name : 'Choose a PDF, Word, TXT, Markdown or CSV file'}</span>
        </label>
        <p className={`mt-1.5 text-xs ${tooBig ? 'text-clay-700' : 'text-ink-500'}`}>
          {tooBig ? `That file is over the ${maxMb} MB trial limit.` : `One file, up to ${maxMb} MB. Reading it takes a few moments.`}
        </p>
      </div>

      {error && <p role="alert" className="mt-4 rounded-md bg-clay-50 px-3 py-2 text-sm text-clay-700">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button type="submit" disabled={!subject.trim() || !file || tooBig || busy} className="btn btn-primary">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Building your tutor…</> : 'Create tutor'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost">Cancel</button>
      </div>
    </form>
  );
};
