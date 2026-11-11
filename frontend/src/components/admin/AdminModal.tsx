import React, { useEffect, useState } from 'react';
import { Lock, X, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (token: string) => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const res = await api.adminLogin(password);
      onLoginSuccess(res.token);
      setPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="anim-fade-in fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" className="anim-rise relative w-full max-w-sm overflow-hidden rounded-lg border border-ink-200 bg-surface p-7 shadow-xl">
        <button onClick={onClose} className="absolute right-3 top-3 rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-700" aria-label="Close dialog">
          <X className="h-5 w-5" />
        </button>

        <span className="relative mb-4 flex h-11 w-11 items-center justify-center rounded-md bg-board-800 text-[#f5efe4]">
          <Lock className="h-6 w-6" />
        </span>
        <h3 id="admin-dialog-title" className="relative text-2xl font-semibold text-ink-900">Instructor sign-in</h3>
        <p className="relative mb-5 mt-1 text-sm text-ink-500">Enter your password to manage course materials and see how students are doing.</p>

        {error && (
          <div role="alert" className="anim-rise mb-4 flex items-center gap-2 rounded-lg bg-clay-50 px-3 py-2.5 text-sm text-clay-700">
            <AlertCircle className="h-4 w-4 shrink-0" /> <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="relative space-y-4">
          <div>
            <label htmlFor="admin-password" className="mb-1.5 block text-sm font-semibold text-ink-800">Password</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your admin password"
              className="w-full rounded-lg border border-ink-300 bg-white px-4 py-3 text-sm focus:border-board-500 focus:outline-none focus:ring-2 focus:ring-board-500/20"
              autoFocus
            />
          </div>
          <button type="submit" disabled={!password || isLoading} className="btn btn-primary w-full !py-3">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};
