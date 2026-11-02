import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, AUTH_EXPIRED_EVENT, getUserToken, setUserToken } from '../../services/api';
import type { AuthUser } from '../../types';

interface AuthValue {
  /** undefined while the saved sign-in is being checked, null when signed out. */
  user: AuthUser | null | undefined;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null | undefined>(getUserToken() ? undefined : null);

  useEffect(() => {
    if (user !== undefined) return;
    let cancelled = false;
    api.me().then((u) => {
      if (cancelled) return;
      if (!u) setUserToken(null);
      setUser(u);
    }).catch(() => { if (!cancelled) setUser(null); });
    return () => { cancelled = true; };
  }, [user]);

  // Any student request answered with 401 means the sign-in expired.
  useEffect(() => {
    const expired = () => { setUserToken(null); setUser(null); };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    setUserToken(res.token);
    setUser(res.user);
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const res = await api.signup(name, email, password);
    setUserToken(res.token);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUserToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signUp, signOut }), [user, signIn, signUp, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
