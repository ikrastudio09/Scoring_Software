import { useEffect } from 'react';
import { Link } from 'react-router';
import { useApi, useLiveMatch } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import MatchCard from '../components/MatchCard.jsx';
import { Card, Empty, ErrorState, SectionTitle, Spinner } from '../components/ui.jsx';

function LiveMatchCard({ match }) {
  const { live: view } = useLiveMatch({ api, live, matchId: match.id, channel: 'viewer' });
  return <MatchCard match={match} live={view || match.live} />;
}

export default function Home() {
  const { data, error, loading, reload } = useApi(api, '/home');
  // Refresh the lists when a match starts, finishes or changes status.
  useEffect(() => live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') reload(); }), [reload]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const t = data.tournament;

  return (
    <div>
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-brand p-5 text-white shadow-sm">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-accent/30" />
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">{t.season ? `Season ${t.season}` : 'Tournament'}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{t.name}</h1>
        {t.description && <p className="mt-1 max-w-xl text-sm text-white/80">{t.description}</p>}
        <p className="mt-3 text-sm text-white/80">{data.counts.completed} of {data.counts.total} matches played</p>
      </div>

      <SectionTitle>{data.live.length ? 'Live now' : 'Live'}</SectionTitle>
      {data.live.length
        ? <div className="grid gap-3 sm:grid-cols-2">{data.live.map((m) => <LiveMatchCard key={m.id} match={m} />)}</div>
        : <Empty>No match in progress right now.</Empty>}

      <SectionTitle action={<Link to="/matches?tab=fixtures" className="text-sm font-medium text-brand">All fixtures</Link>}>Upcoming</SectionTitle>
      {data.upcoming.length
        ? <div className="grid gap-3 sm:grid-cols-2">{data.upcoming.map((m) => <MatchCard key={m.id} match={m} />)}</div>
        : <Empty>No upcoming fixtures.</Empty>}

      <SectionTitle action={<Link to="/matches?tab=results" className="text-sm font-medium text-brand">All results</Link>}>Recent results</SectionTitle>
      {data.recent.length
        ? <div className="grid gap-3 sm:grid-cols-2">{data.recent.map((m) => <MatchCard key={m.id} match={m} />)}</div>
        : <Empty>No results yet.</Empty>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['/points', 'Points table'], ['/stats', 'Statistics'], ['/teams', 'Teams'], ['/players', 'Players']].map(([to, label]) => (
          <Link key={to} to={to}><Card className="p-4 text-center text-sm font-semibold text-slate-800 hover:text-brand">{label}</Card></Link>
        ))}
      </div>
    </div>
  );
}
