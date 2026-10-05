import { NavLink, Outlet, Link, useLocation } from 'react-router';
import { ErrorBoundary, useConnectionStatus } from '@cricket/client';
import { live } from '../lib/runtime.js';
import { useTournament } from '../lib/tournament.jsx';

const NAV = [
  { to: '/', label: 'Home', icon: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z' },
  { to: '/matches', label: 'Matches', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/points', label: 'Table', icon: 'M4 5h16v14H4zM4 10h16M10 5v14' },
  { to: '/stats', label: 'Stats', icon: 'M5 20V10m7 10V4m7 16v-7' },
  { to: '/teams', label: 'Teams', icon: 'M16 11a4 4 0 10-8 0m12 9a8 8 0 00-16 0' },
];

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
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh pb-20 md:pb-8">
      <header className="pt-safe sticky top-0 z-30 bg-brand text-white shadow">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            {t?.logoUrl
              ? <img src={t.logoUrl} alt="" className="h-8 w-8 rounded-full bg-white object-contain" />
              : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-black">{(t?.shortName || 'CK').slice(0, 3)}</span>}
            <span className="truncate font-semibold tracking-tight">{t?.name || 'Cricket'}</span>
          </Link>
          <nav className="ml-auto hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}>
                {n.label}
              </NavLink>
            ))}
            <NavLink to="/players" className={({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/20' : 'hover:bg-white/10'}`}>Players</NavLink>
          </nav>
        </div>
        <ConnectionBanner />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <ErrorBoundary key={pathname}><Outlet /></ErrorBoundary>
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-slate-500'}`}>
              <Icon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
