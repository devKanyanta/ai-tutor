import { useState, useEffect, useCallback } from 'react';
import { LogOut } from 'lucide-react';
import { useRoute, navigate, Link } from './router';
import { Logo } from './components/Logo';
import { Landing } from './components/site/Landing';
import { LessonPage } from './components/lesson/LessonPage';
import { DocumentManager } from './components/admin/DocumentManager';
import { MetricsOverview } from './components/admin/MetricsOverview';
import { AdminModal } from './components/admin/AdminModal';
import type { DocumentItem, Metrics } from './types';
import { api, UNAUTHORIZED } from './services/api';

const Studio: React.FC = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('ai_tutor_admin_token'));
  const [loginOpen, setLoginOpen] = useState(!localStorage.getItem('ai_tutor_admin_token'));
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  const signOut = useCallback(() => {
    setToken(null);
    localStorage.removeItem('ai_tutor_admin_token');
    setDocuments([]);
    setMetrics(null);
  }, []);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const [docs, m] = await Promise.all([api.getDocuments(t), api.getMetrics(t)]);
      setDocuments(docs.documents);
      setMetrics(m);
    } catch (err) {
      console.error('Error fetching admin data:', err);
      if (err instanceof Error && err.message === UNAUTHORIZED) { signOut(); setLoginOpen(true); }
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => { if (token) void load(token); }, [token, load]);

  // Keep indexing status fresh while any document is still being processed.
  useEffect(() => {
    if (!token || !documents.some((d) => d.status === 'PENDING' || d.status === 'INDEXING')) return;
    const timer = window.setTimeout(() => void load(token), 2500);
    return () => window.clearTimeout(timer);
  }, [documents, token, load]);

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
            <div className="mb-8">
              <h1 className="text-3xl text-ink-900 sm:text-4xl">Course library</h1>
              <p className="mt-2 max-w-2xl text-ink-600">
                Upload syllabi, readings and notes. The tutor teaches only from what you add here.
              </p>
            </div>
            <MetricsOverview metrics={metrics} loading={loading && !metrics} />
            <DocumentManager token={token} documents={documents} loading={loading && documents.length === 0} onRefresh={() => void load(token)} />
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-md text-center">
            <h1 className="text-3xl text-ink-900">Instructor studio</h1>
            <p className="mt-3 text-ink-600">Sign in to manage your course materials and see how students are using the tutor.</p>
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
  return (
    <div key={route} className="anim-fade-in">
      {route === '/' && <Landing />}
      {route === '/learn' && <LessonPage />}
      {route === '/studio' && <Studio />}
    </div>
  );
}

export default App;
