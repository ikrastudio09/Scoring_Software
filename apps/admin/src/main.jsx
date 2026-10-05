import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { ErrorBoundary } from '@cricket/client';
import './index.css';
import { AuthProvider, RequireAuth, useAuth } from './lib/auth.jsx';
import { ConnectionPill, ToastProvider } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ScoringConsole from './pages/ScoringConsole.jsx';
import MatchSetup from './pages/MatchSetup.jsx';
import Fixtures from './pages/Fixtures.jsx';
import Teams from './pages/Teams.jsx';
import { TournamentSettings, Users, Tools } from './pages/Settings.jsx';

function Shell() {
  const { user, logout, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const link = ({ isActive }) => `rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-white/15 text-white' : 'text-slate-300 hover:text-white'}`;
  return (
    <div className="min-h-dvh">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-4 py-2">
          <span className="mr-3 font-bold">🏏 Scorer</span>
          <NavLink to="/" end className={link}>Matches</NavLink>
          <NavLink to="/fixtures" className={link}>Fixtures</NavLink>
          <NavLink to="/teams" className={link}>Teams</NavLink>
          {isAdmin && <NavLink to="/settings" className={link}>Settings</NavLink>}
          {isAdmin && <NavLink to="/users" className={link}>Users</NavLink>}
          {isAdmin && <NavLink to="/system" className={link}>System</NavLink>}
          <span className="ml-auto flex items-center gap-3 text-sm">
            <ConnectionPill />
            <a href="/" target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white">Viewer ↗</a>
            <a href="/led/" target="_blank" rel="noreferrer" className="text-slate-300 hover:text-white">LED ↗</a>
            <span className="text-slate-400">{user?.username}</span>
            <button type="button" onClick={logout} className="text-slate-300 hover:text-white">Sign out</button>
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4"><ErrorBoundary key={pathname}><Outlet /></ErrorBoundary></main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="login" element={<Login />} />
            <Route element={<RequireAuth><Shell /></RequireAuth>}>
              <Route index element={<Dashboard />} />
              <Route path="fixtures" element={<Fixtures />} />
              <Route path="teams" element={<Teams />} />
              <Route path="settings" element={<TournamentSettings />} />
              <Route path="users" element={<Users />} />
              <Route path="system" element={<Tools />} />
              <Route path="matches/:id/setup" element={<MatchSetup />} />
              <Route path="matches/:id/score" element={<ScoringConsole />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
