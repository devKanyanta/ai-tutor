import { useState } from 'react';
import { AlertCircle, ArrowRight, BookOpen, Loader2, Plus, X } from 'lucide-react';
import { api, UNAUTHORIZED } from '../../services/api';
import type { TutorAdmin, TutorInput } from '../../types';

const EMPTY: TutorInput = { name: '', subject: '', description: '', instructions: '' };
const field = 'w-full rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm focus:border-board-500 focus:outline-none focus:ring-2 focus:ring-board-500/20';

interface TutorFormProps {
  token: string;
  /** Tutor being edited, or null to create a new one. */
  tutor: TutorAdmin | null;
  onSaved: (tutor: TutorAdmin) => void;
  onCancel: () => void;
  onUnauthorized: () => void;
}

export const TutorForm: React.FC<TutorFormProps> = ({ token, tutor, onSaved, onCancel, onUnauthorized }) => {
  const [form, setForm] = useState<TutorInput>(tutor ? { name: tutor.name, subject: tutor.subject, description: tutor.description, instructions: tutor.instructions } : EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof TutorInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      onSaved(await api.saveTutor(token, form, tutor?.id));
    } catch (err) {
      if (err instanceof Error && err.message === UNAUTHORIZED) onUnauthorized();
      else setError(err instanceof Error ? err.message : 'Could not save the tutor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card anim-rise space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-serif text-xl font-semibold text-ink-900">{tutor ? 'Edit tutor' : 'Create a tutor'}</h2>
        <button type="button" onClick={onCancel} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700" aria-label="Cancel"><X className="h-5 w-5" /></button>
      </div>
      {error && <div role="alert" className="flex items-center gap-2 rounded-lg bg-clay-50 px-3 py-2.5 text-sm text-clay-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tutor-name" className="mb-1.5 block text-sm font-semibold text-ink-800">Tutor name</label>
          <input id="tutor-name" required maxLength={80} value={form.name} onChange={set('name')} placeholder="e.g. Ms. Banda’s Biology Tutor" className={field} autoFocus />
        </div>
        <div>
          <label htmlFor="tutor-subject" className="mb-1.5 block text-sm font-semibold text-ink-800">Subject or course</label>
          <input id="tutor-subject" maxLength={120} value={form.subject} onChange={set('subject')} placeholder="e.g. Grade 11 Biology" className={field} />
        </div>
      </div>
      <div>
        <label htmlFor="tutor-description" className="mb-1.5 block text-sm font-semibold text-ink-800">What students will see</label>
        <textarea id="tutor-description" rows={2} maxLength={600} value={form.description} onChange={set('description')} placeholder="A sentence or two about what this tutor covers." className={field} />
      </div>
      <div>
        <label htmlFor="tutor-instructions" className="mb-1.5 block text-sm font-semibold text-ink-800">Teaching guidance <span className="font-normal text-ink-500">(optional, private)</span></label>
        <textarea id="tutor-instructions" rows={3} maxLength={2000} value={form.instructions} onChange={set('instructions')} placeholder="How should this tutor teach? e.g. use everyday examples, keep a friendly tone, always connect ideas to exam questions." className={field} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost">Cancel</button>
        <button type="submit" disabled={!form.name.trim() || saving} className="btn btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tutor ? 'Save changes' : 'Create tutor'}
        </button>
      </div>
    </form>
  );
};

interface TutorListProps {
  tutors: TutorAdmin[];
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}

export const TutorList: React.FC<TutorListProps> = ({ tutors, loading, onOpen, onCreate }) => (
  <section aria-label="Your tutors">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-serif text-xl font-semibold text-ink-900">
        Your tutors <span className="ml-1 rounded-full bg-ink-100 px-2 py-0.5 font-sans text-xs font-semibold text-ink-600">{tutors.length}</span>
      </h2>
      <button onClick={onCreate} className="btn btn-primary !py-2 text-sm"><Plus className="h-4 w-4" /> New tutor</button>
    </div>
    {loading ? (
      <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">{[0, 1].map((i) => <div key={i} className="skeleton h-36 rounded-lg" />)}</div>
    ) : tutors.length === 0 ? (
      <div className="card flex flex-col items-center px-6 py-12 text-center">
        <p className="font-serif text-lg font-semibold text-ink-900">Create your first tutor</p>
        <p className="mt-1 max-w-md text-sm text-ink-500">Each tutor has its own course materials, so students get a focused expert for one subject. Make as many as you need.</p>
        <button onClick={onCreate} className="btn btn-primary mt-5"><Plus className="h-4 w-4" /> New tutor</button>
      </div>
    ) : (
      <ul className="grid gap-4 sm:grid-cols-2">
        {tutors.map((t) => (
          <li key={t.id}>
            <button onClick={() => onOpen(t.id)} className="card flex h-full w-full flex-col p-5 text-left transition-shadow hover:shadow-md">
              <span className="font-serif text-lg font-semibold text-ink-900">{t.name}</span>
              {t.subject && <span className="text-sm font-medium text-board-600">{t.subject}</span>}
              <span className="mt-auto flex items-center justify-between pt-4 text-xs font-medium text-ink-500">
                <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" /> {t.ready_documents}/{t.document_count} documents ready</span>
                <span className="flex items-center gap-1 text-board-700">Manage <ArrowRight className="h-3.5 w-3.5" /></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
