import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Link } from 'react-router';
import './index.css';
import Layout from './components/Layout.jsx';
import { TournamentProvider } from './lib/tournament.jsx';
import { initNative } from './lib/native.js';
import Home from './pages/Home.jsx';
import Matches from './pages/Matches.jsx';
import MatchPage from './pages/MatchPage.jsx';
import Points from './pages/Points.jsx';
import Stats from './pages/Stats.jsx';
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
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="matches" element={<Matches />} />
            <Route path="matches/:id" element={<MatchPage />} />
            <Route path="points" element={<Points />} />
            <Route path="stats" element={<Stats />} />
            <Route path="teams" element={<Teams />} />
            <Route path="teams/:id" element={<TeamPage />} />
            <Route path="players" element={<Players />} />
            <Route path="players/:id" element={<PlayerPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </TournamentProvider>
    </BrowserRouter>
  </StrictMode>,
);

initNative();
