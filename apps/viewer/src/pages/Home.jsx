import { useEffect } from 'react';
import { Link } from 'react-router';
import { formatNrr } from '@cricket/shared';
import { useApi, useLiveMatch } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import MatchCard from '../components/MatchCard.jsx';
import { LiveHero } from '../components/LivePanel.jsx';
import { Card, Empty, ErrorState, SectionTitle, Spinner, TeamDot, TeamLogo } from '../components/ui.jsx';

const IN_PLAY = ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS'];

/** The one live match, updated after every ball. */
function LiveNow({ match }) {
  const { live: view, lastEnvelope } = useLiveMatch({ api, live, matchId: match.id, channel: 'viewer' });
  const v = view || match.live;
  if (!v?.current) return <MatchCard match={match} live={v} />;
  return (
    <Link to={`/matches/${match.id}`} className="block" aria-label="Open the live match">
      <LiveHero live={v} envelope={lastEnvelope} compact />
      <p className="mt-2 text-right text-sm font-semibold text-brand">Ball-by-ball commentary →</p>
    </Link>
  );
}

function Leaders({ title, to, rows, value, sub }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link to={to} className="text-xs font-medium text-brand">All</Link>
      </div>
      {!rows?.length ? <p className="px-4 py-4 text-sm text-slate-500">After the first result.</p> : (
        <ol>
          {rows.slice(0, 5).map((p, i) => (
            <li key={p.playerId} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 first:border-0">
              <span className={`w-4 text-xs tnum ${i ? 'text-slate-400' : 'font-bold text-brand'}`}>{i + 1}</span>
              <Link to={`/players/${p.playerId}`} className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium hover:text-brand">
                <TeamDot color={p.teamInfo?.color} size="h-2.5 w-2.5" /><span className="truncate">{p.name}</span>
                <span className="text-xs font-normal text-slate-400">{sub?.(p)}</span>
              </Link>
              <span className="tnum font-bold">{value(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function MiniTable({ table }) {
  const rows = table?.groups.flatMap((g) => g.rows).sort((a, b) => a.position - b.position).slice(0, 5) || [];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Points table</h3>
        <Link to="/points" className="text-xs font-medium text-brand">Full table</Link>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className="border-t border-slate-100 first:border-0">
              <td className="w-8 py-2 pl-4 text-xs text-slate-400 tnum">{r.position}</td>
              <td><Link to={`/teams/${r.team.id}`} className="flex items-center gap-2 font-medium hover:text-brand"><TeamLogo team={r.team} size="h-6 w-6 text-[8px]" /><span className="truncate">{r.team.shortName}</span></Link></td>
              <td className="w-10 text-center text-xs text-slate-500 tnum">{r.played}</td>
              <td className="w-10 text-center font-bold tnum">{r.points}</td>
              <td className="w-16 pr-4 text-right text-xs tnum text-slate-600">{formatNrr(r.nrr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function Home() {
  const { data, error, loading, reload } = useApi(api, '/home');
  const table = useApi(api, '/points-table');
  const stats = useApi(api, '/stats/leaderboards');
  // Refresh the lists when a match starts, finishes or changes status.
  useEffect(() => live.onTournament((e) => {
    if (e.type === 'MATCH_STATUS_CHANGED') reload();
    if (e.type === 'POINTS_TABLE_UPDATED') table.reload();
    if (e.type === 'STATISTICS_UPDATED') stats.reload();
  }), [reload, table.reload, stats.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const t = data.tournament;
  const inPlay = data.live.filter((m) => IN_PLAY.includes(m.status));
  const ready = data.live.filter((m) => !IN_PLAY.includes(m.status));
  const lb = stats.data;

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{t.season ? `Season ${t.season}` : 'Tournament'}</p>
          <h1 className="truncate text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{t.name}</h1>
        </div>
        <p className="shrink-0 text-right text-xs text-slate-500"><b className="tnum text-base text-slate-900">{data.counts.completed}</b>/{data.counts.total}<br />matches played</p>
      </div>

      {inPlay.length > 0 ? (
        <section className="mb-6">{inPlay.map((m) => <LiveNow key={m.id} match={m} />)}</section>
      ) : (
        <section className="mb-6">
          {ready.length || data.upcoming.length ? (
            <>
              <SectionTitle>Next match</SectionTitle>
              <MatchCard match={ready[0] || data.upcoming[0]} live={ready[0]?.live} />
            </>
          ) : <Empty>No match in progress right now.</Empty>}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <MiniTable table={table.data} />
        <Leaders title="Most valuable players" to="/stats?tab=mvp" rows={lb?.mostImpact} value={(p) => Math.round(p.impact.total)} sub={(p) => `${p.mvpAwards ? `${p.mvpAwards}× MVP` : `${p.matches} m`}`} />
        <Leaders title="Most runs" to="/stats" rows={lb?.mostRuns} value={(p) => p.batting.runs} sub={(p) => `SR ${p.batting.strikeRate ?? '-'}`} />
        <Leaders title="Most wickets" to="/stats?tab=bowling" rows={lb?.mostWickets} value={(p) => p.bowling.wickets} sub={(p) => `econ ${p.bowling.economy ?? '-'}`} />
      </div>

      <SectionTitle action={<Link to="/matches?tab=results" className="text-sm font-medium text-brand">All results</Link>}>Recent results</SectionTitle>
      {data.recent.length
        ? <div className="grid gap-3 sm:grid-cols-2">{data.recent.slice(0, 4).map((m) => <MatchCard key={m.id} match={m} />)}</div>
        : <Empty>No results yet.</Empty>}

      <SectionTitle action={<Link to="/matches?tab=fixtures" className="text-sm font-medium text-brand">All fixtures</Link>}>Upcoming</SectionTitle>
      {data.upcoming.length
        ? <div className="grid gap-3 sm:grid-cols-2">{data.upcoming.slice(0, 4).map((m) => <MatchCard key={m.id} match={m} />)}</div>
        : <Empty>No upcoming fixtures.</Empty>}
    </div>
  );
}
