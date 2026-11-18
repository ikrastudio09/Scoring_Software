import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Link } from 'react-router';
import './index.css';
import Layout from './components/Layout.jsx';
import { TournamentProvider } from './lib/tournament.jsx';
import { CategoryScope, LegacyRedirect } from './lib/category.jsx';
import { initNative } from './lib/native.js';
import Landing from './pages/Landing.jsx';
import Home from './pages/Home.jsx';
import Matches from './pages/Matches.jsx';
import MatchPage from './pages/MatchPage.jsx';
import Points from './pages/Points.jsx';
import Stats from './pages/Stats.jsx';
import Centre from './pages/Centre.jsx';
import Qualification from './pages/Qualification.jsx';
import { Teams, TeamPage } from './pages/Teams.jsx';
import { Players, PlayerPage } from './pages/Players.jsx';

function NotFound() {
  return <div className="py-16 text-center"><p className="text-lg font-semibold">Page not found</p><Link to="/" className="mt-2 inline-block text-brand">Go home</Link></div>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TournamentProvider>
        <Routes>
          {/* Tournament landing: the three categories and the one live match. */}
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            {/* Links from before categories (shared links, installed apps) → remembered category. */}
            {['matches', 'matches/:id', 'points', 'stats', 'teams', 'teams/:id', 'players', 'players/:id'].map((p) => (
              <Route key={p} path={p} element={<LegacyRedirect />} />
            ))}
          </Route>
          {/* One category's dashboard: /mens/..., /ladies/..., /kids/... */}
          <Route path=":cat" element={<CategoryScope />}>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="matches" element={<Matches />} />
              <Route path="matches/:id" element={<MatchPage />} />
              <Route path="points" element={<Points />} />
              <Route path="stats" element={<Stats />} />
              <Route path="centre" element={<Centre />} />
              <Route path="qualification" element={<Qualification />} />
              <Route path="teams" element={<Teams />} />
              <Route path="teams/:id" element={<TeamPage />} />
              <Route path="players" element={<Players />} />
              <Route path="players/:id" element={<PlayerPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
          <Route element={<Layout />}><Route path="*" element={<NotFound />} /></Route>
        </Routes>
      </TournamentProvider>
    </BrowserRouter>
  </StrictMode>,
);

initNative();

// Installable PWA (browser only; the Android app ships its own copy of the bundle).
if (import.meta.env.PROD && 'serviceWorker' in navigator && !window.Capacitor?.isNativePlatform?.()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
