import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Logo } from '../Logo';
import { useAuth } from './AuthContext';

const input = 'w-full rounded-lg border border-ink-300 bg-white px-4 py-3 text-sm focus:border-board-500 focus:outline-none focus:ring-2 focus:ring-board-500/20';

/** Students must have an account before they can reach any tutor. */
export const AuthPage: React.FC = () => {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') await signUp(name, email, password);
      else await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const signup = mode === 'signup';
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="border-b border-ink-200 bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-8">
          <Logo />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
        <div className="card anim-rise w-full max-w-sm p-7">
          <h1 className="text-2xl font-semibold text-ink-900">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mb-5 mt-1 text-sm text-ink-500">
            {signup ? 'Try Socratic free: make a tutor from your own course notes. Your progress is saved to your account.' : 'Sign in to pick up your course where you left off.'}
          </p>
          {error && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-lg bg-clay-50 px-3 py-2.5 text-sm text-clay-700">
              <AlertCircle className="h-4 w-4 shrink-0" /> <span>{error}</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            {signup && (
              <div>
                <label htmlFor="auth-name" className="mb-1.5 block text-sm font-semibold text-ink-800">Your name</label>
                <input id="auth-name" required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input} autoFocus />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-semibold text-ink-800">Email</label>
              <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoFocus={!signup} />
            </div>
            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-sm font-semibold text-ink-800">Password</label>
              <input id="auth-password" type="password" required minLength={signup ? 8 : 1} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
              {signup && <p className="mt-1 text-xs text-ink-500">At least 8 characters.</p>}
            </div>
            <button type="submit" disabled={busy} className="btn btn-primary w-full !py-3">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : signup ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-ink-600">
            {signup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(''); }} className="font-semibold text-board-600 underline underline-offset-2 hover:text-board-800">
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
};
