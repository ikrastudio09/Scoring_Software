import { Link, useParams } from 'react-router';
import { formatNrr } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import MatchCard from '../components/MatchCard.jsx';
import { Avatar, Card, ErrorState, SectionTitle, Spinner, TeamLogo } from '../components/ui.jsx';
import { num } from '../lib/format.js';

const ROLE = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', wicketkeeper: 'Wicket-keeper' };
const OUTCOME = { W: 'bg-emerald-500', L: 'bg-red-500', T: 'bg-slate-400', N: 'bg-slate-300' };

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
            <Card className="flex items-center gap-3 overflow-hidden p-4 hover:ring-brand/40" style={{ boxShadow: `inset 4px 0 0 ${t.color}` }}>
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

function LeaderList({ title, rows, value }) {
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      {!rows.length ? <p className="px-4 py-3 text-sm text-slate-400">—</p> : rows.map((p) => (
        <Link key={p.playerId} to={`/players/${p.playerId}`} className="flex items-center gap-2 border-t border-slate-100 px-4 py-2 text-sm first:border-0 hover:bg-slate-50">
          <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
          <span className="tnum font-bold">{value(p)}</span>
        </Link>
      ))}
    </Card>
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
  const st = t.stats;
  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-2xl bg-slate-950 text-white">
        <div className="h-1.5" style={{ background: t.color }} />
        <div className="flex items-center gap-4 p-5">
          <TeamLogo team={t} size="h-16 w-16 text-base" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight">{t.name}</h1>
            <p className="text-sm text-white/60">{t.shortName}{t.homeGround ? ` · ${t.homeGround}` : ''}{r.position ? ` · ${r.position}${['st', 'nd', 'rd'][r.position - 1] || 'th'} in the table` : ''}</p>
          </div>
          {r.recent?.length > 0 && (
            <div className="hidden gap-1 sm:flex" title="Recent results">
              {[...r.recent].reverse().map((m) => <span key={m.match} className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${OUTCOME[m.outcome]}`}>{m.outcome}</span>)}
            </div>
          )}
        </div>
        <div className="grid grid-cols-4 border-t border-white/10 text-center sm:grid-cols-8">
          {[['P', r.played], ['W', r.won], ['L', r.lost], ['T/NR', r.tied + r.noResult], ['Pts', r.points], ['NRR', formatNrr(r.nrr)], ['Avg', r.averageScore ?? '-'], ['High', r.highest ? `${r.highest.runs}/${r.highest.wickets}` : '-']].map(([k, v]) => (
            <div key={k} className="p-3"><p className="tnum text-base font-bold">{v}</p><p className="text-[10px] uppercase tracking-wide text-white/50">{k}</p></div>
          ))}
        </div>
      </div>

      {st && (st.batting.runs > 0 || st.bowling.wickets > 0) && (
        <>
          <SectionTitle>Team statistics</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 text-center sm:grid-cols-6">
            {[['Runs', st.batting.runs], ['4s / 6s', `${st.batting.fours} / ${st.batting.sixes}`], ['50+ scores', st.batting.fifties], ['Wickets', st.bowling.wickets], ['Economy', num(st.bowling.economy)], ['Catches', st.fielding.catches]].map(([k, v]) => (
              <div key={k} className="p-3"><p className="tnum text-lg font-bold">{v}</p><p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p></div>
            ))}
          </Card>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <LeaderList title="Top run scorers" rows={st.topBatters} value={(p) => p.runs} />
            <LeaderList title="Top wicket takers" rows={st.topBowlers} value={(p) => p.wickets} />
            <LeaderList title="Highest impact" rows={st.mvp} value={(p) => Math.round(p.impact)} />
          </div>
        </>
      )}

      <SectionTitle>Squad</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {t.squad.map((p) => (
          <Link key={p.id} to={`/players/${p.id}`}>
            <Card className="flex items-center gap-3 p-3 hover:ring-brand/40">
              <Avatar name={p.name} photoUrl={p.photoUrl} color={t.color} size="h-11 w-11 text-xs" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{p.name}{t.captain === p.id && <span className="ml-1 text-xs text-brand">(c)</span>}</p>
                <p className="truncate text-xs text-slate-500">{p.playerType || ROLE[p.role]}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <SectionTitle>Matches</SectionTitle>
      {matches.data ? <div className="grid gap-3 sm:grid-cols-2">{matches.data.matches.map((m) => <MatchCard key={m.id} match={m} />)}</div> : <Spinner />}
    </div>
  );
}
