import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, live, tokenStore } from './runtime.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    live.reconnect();
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api.get('/auth/me').then(({ user: u }) => setUser(u)).catch((err) => {
      // Keep the token if we are merely offline: the scorer must not be logged out mid-match.
      if (err.status === 401) logout();
      else setUser({ offline: true, username: 'offline', role: 'scorer' });
    }).finally(() => setChecking(false));
  }, [logout]);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [logout]);

  const login = useCallback(async (username, password) => {
    const out = await api.post('/auth/login', { username, password });
    tokenStore.set(out.token);
    setUser(out.user);
    live.reconnect(); // re-handshake with the token for the admin channel
    return out.user;
  }, []);

  return <AuthCtx.Provider value={{ user, checking, login, logout, isAdmin: user?.role === 'admin' }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

export function RequireAuth({ children }) {
  const { user, checking } = useAuth();
  const loc = useLocation();
  if (checking) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
