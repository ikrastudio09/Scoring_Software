import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './runtime.js';

const Ctx = createContext(null);
const CACHE_KEY = 'tournament.v1';

function applyBranding(t) {
  if (!t) return;
  const root = document.documentElement;
  if (t.primaryColor) root.style.setProperty('--brand', t.primaryColor);
  if (t.accentColor) root.style.setProperty('--accent', t.accentColor);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.primaryColor || '#0f766e');
  document.title = t.name || 'Live Cricket';
}

/** Tournament info + branding. Cached locally so the app brands itself instantly, even offline. */
export function TournamentProvider({ children }) {
  const [t, setT] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
  });
  useEffect(() => { applyBranding(t); }, [t]);
  useEffect(() => {
    api.get('/tournament').then(({ tournament }) => {
      setT(tournament);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(tournament)); } catch { /* storage unavailable */ }
    }).catch(() => {});
  }, []);
  return <Ctx.Provider value={t}>{children}</Ctx.Provider>;
}

export const useTournament = () => useContext(Ctx);
