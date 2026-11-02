import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, LogOut, Pencil, Trash2 } from 'lucide-react';
import { useRoute, useQueryParam, navigate, Link } from './router';
import { Logo } from './components/Logo';
import { Landing } from './components/site/Landing';
import { LessonPage } from './components/lesson/LessonPage';
import { DocumentManager } from './components/admin/DocumentManager';
import { MetricsOverview } from './components/admin/MetricsOverview';
import { AdminModal } from './components/admin/AdminModal';
import { TutorForm, TutorList } from './components/admin/TutorManager';
import { TutorPicker } from './components/tutors/TutorPicker';
import type { DocumentItem, Metrics, TutorAdmin } from './types';
import { api, UNAUTHORIZED } from './services/api';

const Studio: React.FC = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('ai_tutor_admin_token'));
  const [loginOpen, setLoginOpen] = useState(!localStorage.getItem('ai_tutor_admin_token'));
  const [tutors, setTutors] = useState<TutorAdmin[]>([]);
  const [tutorsLoaded, setTutorsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<'closed' | 'create' | 'edit'>('closed');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  const selected = tutors.find((t) => t.id === selectedId) ?? null;

  const signOut = useCallback(() => {
    setToken(null);
    localStorage.removeItem('ai_tutor_admin_token');
    setTutors([]);
    setTutorsLoaded(false);
    setSelectedId(null);
    setDocuments([]);
    setMetrics(null);
  }, []);

  const unauthorized = useCallback(() => { signOut(); setLoginOpen(true); }, [signOut]);

  const loadTutors = useCallback(async (t: string) => {
    try {
      setTutors(await api.getAdminTutors(t));
      setTutorsLoaded(true);
    } catch (err) {
      console.error('Error fetching tutors:', err);
      if (err instanceof Error && err.message === UNAUTHORIZED) unauthorized();
    }
  }, [unauthorized]);

  const loadTutorData = useCallback(async (t: string, tutorId: string) => {
    setLoading(true);
    try {
      const [docs, m] = await Promise.all([api.getDocuments(t, tutorId), api.getMetrics(t, tutorId)]);
      setDocuments(docs.documents);
      setMetrics(m);
    } catch (err) {
      console.error('Error fetching tutor data:', err);
      if (err instanceof Error && err.message === UNAUTHORIZED) unauthorized();
    } finally {
      setLoading(false);
    }
  }, [unauthorized]);

  useEffect(() => { if (token) void loadTutors(token); }, [token, loadTutors]);

  useEffect(() => {
    setDocuments([]);
    setMetrics(null);
    if (token && selectedId) void loadTutorData(token, selectedId);
  }, [token, selectedId, loadTutorData]);

  // Keep indexing status fresh while any document is still being processed.
  useEffect(() => {
    if (!token || !selectedId || !documents.some((d) => d.status === 'PENDING' || d.status === 'INDEXING')) return;
    const timer = window.setTimeout(() => void loadTutorData(token, selectedId), 2500);
    return () => window.clearTimeout(timer);
  }, [documents, token, selectedId, loadTutorData]);

  const refresh = () => {
    if (!token) return;
    void loadTutors(token);
    if (selectedId) void loadTutorData(token, selectedId);
  };

  const removeTutor = async () => {
    if (!token || !selected) return;
    if (!confirm(`Delete "${selected.name}"? Its course materials and all student sessions with it will be permanently removed.`)) return;
    try {
      await api.deleteTutor(token, selected.id);
      setSelectedId(null);
      void loadTutors(token);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete the tutor');
    }
  };

  const saved = (tutor: TutorAdmin) => {
    setForm('closed');
    setSelectedId(tutor.id);
    if (token) void loadTutors(token);
  };

  return (
    <div className="min-h-dvh bg-paper">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-ink-200 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="hidden rounded bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600 sm:inline">Instructor studio</span>
          </div>
          <div className="flex items-center gap-1">
            <Link to="/learn" className="rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">Student view</Link>
            {token && (
              <button onClick={() => { signOut(); navigate('/'); }} className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900">
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        {token ? (
          <div className="anim-fade-in">
            {form !== 'closed' ? (
              <TutorForm
                token={token}
                tutor={form === 'edit' ? selected : null}
                onSaved={saved}
                onCancel={() => setForm('closed')}
                onUnauthorized={unauthorized}
              />
            ) : !selected ? (
              <>
                <div className="mb-8">
                  <h1 className="text-3xl text-ink-900 sm:text-4xl">Your AI tutors</h1>
                  <p className="mt-2 max-w-2xl text-ink-600">
                    Create a tutor for each course or subject. Every tutor teaches only from its own materials, so nothing gets mixed up.
                  </p>
                </div>
                <TutorList tutors={tutors} loading={!tutorsLoaded} onOpen={setSelectedId} onCreate={() => setForm('create')} />
              </>
            ) : (
              <>
                <button onClick={() => setSelectedId(null)} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-board-600 hover:text-board-800">
                  <ArrowLeft className="h-4 w-4" /> All tutors
                </button>
                <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="text-3xl text-ink-900 sm:text-4xl">{selected.name}</h1>
                    {selected.subject && <p className="mt-1 font-medium text-board-600">{selected.subject}</p>}
                    <p className="mt-2 max-w-2xl text-ink-600">Upload syllabi, readings and notes. This tutor teaches only from what you add here.</p>
                  </div>
                  <div className="flex gap-2">
                    <Link to={`/learn?tutor=${encodeURIComponent(selected.id)}`} className="btn btn-ghost !py-2 text-sm">Try it</Link>
                    <button onClick={() => setForm('edit')} className="btn btn-ghost !py-2 text-sm"><Pencil className="h-4 w-4" /> Edit</button>
                    <button onClick={() => void removeTutor()} className="btn btn-danger !py-2 text-sm"><Trash2 className="h-4 w-4" /> Delete</button>
                  </div>
                </div>
                <MetricsOverview metrics={metrics} loading={loading && !metrics} />
                <DocumentManager token={token} tutorId={selected.id} documents={documents} loading={loading && documents.length === 0} onRefresh={refresh} />
              </>
            )}
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-md text-center">
            <h1 className="text-3xl text-ink-900">Instructor studio</h1>
            <p className="mt-3 text-ink-600">Sign in to create AI tutors, manage their course materials and see how students are using them.</p>
            <button onClick={() => setLoginOpen(true)} className="btn btn-primary mt-6 !px-6">Sign in</button>
          </div>
        )}
      </main>

      <AdminModal
        isOpen={loginOpen && !token}
        onClose={() => setLoginOpen(false)}
        onLoginSuccess={(t) => { setToken(t); localStorage.setItem('ai_tutor_admin_token', t); }}
      />
    </div>
  );
};

export function App() {
  const route = useRoute();
  const tutorId = useQueryParam('tutor');
  return (
    <div key={route} className="anim-fade-in">
      {route === '/' && <Landing />}
      {route === '/learn' && (tutorId ? <LessonPage key={tutorId} tutorId={tutorId} /> : <TutorPicker />)}
      {route === '/studio' && <Studio />}
    </div>
  );
}

export default App;
