import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router';
import { ErrorBoundary, useConnectionStatus } from '@cricket/client';
import { BRAND, studioCredit } from '@cricket/shared';
import { api, live } from '../lib/runtime.js';
import { useTournament } from '../lib/tournament.jsx';
import { useCategory } from '../lib/category.jsx';

const NAV = [
  { to: '', label: 'Home', icon: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { to: '/matches', label: 'Matches', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/points', label: 'Table', icon: 'M4 5h16v14H4zM4 10h16M10 5v14' },
  { to: '/stats', label: 'Stats', icon: 'M5 20V10m7 10V4m7 16v-7' },
  { to: '/centre', label: 'Centre', icon: 'M8 21h8m-4-4v4M7 4h10v5a5 5 0 01-10 0zM7 6H4a3 3 0 003 3m10-3h3a3 3 0 01-3 3' },
  { to: '/teams', label: 'Teams', icon: 'M16 11a4 4 0 10-8 0m12 9a8 8 0 00-16 0' },
];

/** The one live match of the whole tournament (any category), kept current by status events. */
function useGlobalLive() {
  const [now, setNow] = useState(null);
  const status = useConnectionStatus(live);
  useEffect(() => {
    const load = () => api.get('/live').then(setNow).catch(() => {});
    load();
    return live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') load(); });
  }, [status]);
  return now?.live && now.inPlay ? now : null;
}

function LivePill() {
  const now = useGlobalLive();
  if (!now) return null;
  const key = now.category?.key || 'mens';
  return (
    <Link to={`/${key}/matches/${now.matchId}`} className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      Live
    </Link>
  );
}

/** Men's / Ladies / Kids. Switching keeps the section (table, stats, …) but leaves detail pages. */
function CategorySwitcher({ ctx }) {
  const { pathname } = useLocation();
  const section = pathname.split('/')[2] || '';
  return (
    <div className="mx-auto flex max-w-5xl gap-1 px-4 pb-2" role="tablist" aria-label="Category">
      {ctx.categories.map((c) => (
        <Link key={c.key} role="tab" aria-selected={c.key === ctx.key} to={`/${c.key}${section ? `/${section}` : ''}`}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${c.key === ctx.key ? 'bg-white text-brand' : 'bg-white/10 text-white hover:bg-white/20'}`}>
          {c.name}
        </Link>
      ))}
    </div>
  );
}

function Icon({ d }) {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function ConnectionBanner() {
  const status = useConnectionStatus(live);
  if (status === 'connected' || status === 'connecting') return null;
  return (
    <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white" role="status">
      {status === 'offline' ? 'Offline — showing the last known scores' : 'Reconnecting… scores will update automatically'}
    </div>
  );
}

export default function Layout() {
  const t = useTournament();
  const ctx = useCategory();
  const { pathname } = useLocation();
  const to = (p) => ctx.path(p);
  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <header className="pt-safe sticky top-0 z-30 bg-brand text-white shadow">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            {/* A logo set in Settings wins; otherwise the official MPL logo bundled with the app. */}
            <img src={t?.logoUrl || `/${BRAND.logoSmall}`} alt="" width="36" height="36" className="h-9 w-9 shrink-0 object-contain" />
            <span className="truncate font-semibold tracking-tight">{t?.name || BRAND.name}</span>
          </Link>
          {ctx && (
            <nav className="ml-auto hidden gap-1 md:flex">
              {NAV.map((n) => (
                <NavLink key={n.to} to={to(n.to)} end={n.to === ''} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}>
                  {n.label}
                </NavLink>
              ))}
              <NavLink to={to('/players')} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}>Players</NavLink>
            </nav>
          )}
          <span className={ctx ? 'ml-auto md:ml-2' : 'ml-auto'}><LivePill /></span>
        </div>
        {ctx && <CategorySwitcher ctx={ctx} />}
        <ConnectionBanner />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <ErrorBoundary key={pathname}><Outlet /></ErrorBoundary>
      </main>
      <footer className="mx-auto max-w-5xl px-4 pb-4 pt-2 text-center text-[11px] text-slate-400">
        {BRAND.name} · Season {BRAND.season} · App {studioCredit()}
      </footer>

      {ctx && (
        <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="grid grid-cols-6">
          {NAV.map((n) => (
            <NavLink key={n.to} to={to(n.to)} end={n.to === ''} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-slate-500'}`}>
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
      )}
    </div>
  );
}
