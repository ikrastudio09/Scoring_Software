import { Link, useParams } from 'react-router';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import MatchCard from '../components/MatchCard.jsx';
import { Card, ErrorState, SectionTitle, Spinner, TeamLogo } from '../components/ui.jsx';

const ROLE = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', wicketkeeper: 'Wicket-keeper' };

export function Teams() {
  const { data, error, reload } = useApi(api, '/teams');
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Teams</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.teams.map((t) => (
          <Link key={t.id} to={`/teams/${t.id}`}>
            <Card className="flex items-center gap-3 p-4 hover:ring-brand/40">
              <TeamLogo team={t} size="h-12 w-12 text-sm" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{t.name}</p>
                <p className="text-xs text-slate-500">{t.players} players{t.group ? ` · Group ${t.group}` : ''}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function TeamPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi(api, `/teams/${id}`, [id]);
  const matches = useApi(api, `/matches?team=${id}`, [id]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const t = data.team;
  const r = t.record;
  return (
    <div>
      <Card className="mb-4 flex items-center gap-4 p-5" style={{ borderTop: `4px solid ${t.color}` }}>
        <TeamLogo team={t} size="h-16 w-16 text-base" />
        <div>
          <h1 className="text-xl font-bold">{t.name}</h1>
          <p className="text-sm text-slate-500">{t.shortName}{t.homeGround ? ` · ${t.homeGround}` : ''}</p>
        </div>
      </Card>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {[['P', r.played], ['W', r.won], ['L', r.lost], ['T', r.tied], ['NR', r.noResult], ['Highest', r.highest ? `${r.highest.runs}/${r.highest.wickets}` : '-'], ['Lowest', r.lowest ? `${r.lowest.runs}/${r.lowest.wickets}` : '-']].map(([k, v]) => (
          <Card key={k} className="p-3 text-center"><p className="tnum text-lg font-bold">{v}</p><p className="text-[11px] uppercase text-slate-500">{k}</p></Card>
        ))}
      </div>

      <SectionTitle>Squad</SectionTitle>
      <Card className="divide-y divide-slate-100">
        {t.squad.map((p) => (
          <Link key={p.id} to={`/players/${p.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
            <span className="font-medium">{p.jerseyNumber !== undefined && p.jerseyNumber !== null && <span className="mr-2 inline-block w-6 text-xs text-slate-400 tnum">#{p.jerseyNumber}</span>}{p.name}{t.captain === p.id && <span className="ml-1 text-xs text-brand">(c)</span>}</span>
            <span className="text-xs text-slate-500">{ROLE[p.role]}</span>
          </Link>
        ))}
      </Card>

      <SectionTitle>Matches</SectionTitle>
      {matches.data ? <div className="grid gap-3 sm:grid-cols-2">{matches.data.matches.map((m) => <MatchCard key={m.id} match={m} />)}</div> : <Spinner />}
    </div>
  );
}
