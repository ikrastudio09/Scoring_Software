import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Card, Empty, ErrorState, SectionTitle, Spinner, TeamDot, TeamLogo } from '../components/ui.jsx';
import { fmtDate, num } from '../lib/format.js';

const ROLE = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', wicketkeeper: 'Wicket-keeper' };

export function Players() {
  const { data, error, reload } = useApi(api, '/players');
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const teams = useMemo(() => {
    const m = new Map();
    for (const p of data?.players || []) m.set(p.team.id, p.team);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const list = useMemo(() => (data?.players || []).filter((p) => (!team || p.team.id === team) && p.name.toLowerCase().includes(q.trim().toLowerCase())), [data, q, team]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Players</h1>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players" aria-label="Search players" className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-brand" />
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team" className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {!list.length && <Empty>No players match.</Empty>}
      <Card className="divide-y divide-slate-100">
        {list.slice(0, 300).map((p) => (
          <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <TeamDot color={p.team.color} />
            <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
            <span className="text-xs text-slate-500">{p.team.shortName} · {ROLE[p.role]}</span>
          </Link>
        ))}
      </Card>
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="p-3 text-center"><p className="tnum text-lg font-bold">{value ?? '-'}</p><p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p></div>;
}

export function PlayerPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi(api, `/players/${id}`, [id]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const p = data.player;
  const c = p.career;
  const b = c?.batting;
  const w = c?.bowling;
  return (
    <div>
      <Card className="mb-4 flex items-center gap-4 p-5">
        {p.photoUrl ? <img src={p.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" /> : <TeamLogo team={p.team} size="h-16 w-16 text-base" />}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{p.name}</h1>
          <p className="text-sm text-slate-500">
            <Link to={`/teams/${p.team.id}`} className="hover:text-brand">{p.team.name}</Link> · {ROLE[p.role]}
          </p>
          <p className="text-xs text-slate-500">{p.battingStyle === 'left' ? 'Left' : 'Right'}-hand bat{p.bowlingStyle ? ` · ${p.bowlingStyle}` : ''}</p>
        </div>
      </Card>

      {!c || !c.matches ? <Empty>No matches played yet.</Empty> : (
        <>
          <SectionTitle>Batting</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6">
            <Stat label="Matches" value={c.matches} /><Stat label="Innings" value={b.innings} /><Stat label="Runs" value={b.runs} />
            <Stat label="Highest" value={b.highestText} /><Stat label="Average" value={num(b.average)} /><Stat label="Strike rate" value={num(b.strikeRate, 1)} />
            <Stat label="Not outs" value={b.notOuts} /><Stat label="Balls" value={b.balls} /><Stat label="4s" value={b.fours} />
            <Stat label="6s" value={b.sixes} /><Stat label="50s" value={b.fifties + b.hundreds} /><Stat label="30s" value={b.thirties} />
          </Card>
          <SectionTitle>Bowling</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6">
            <Stat label="Innings" value={w.innings} /><Stat label="Overs" value={w.overs} /><Stat label="Wickets" value={w.wickets} />
            <Stat label="Best" value={w.bestText} /><Stat label="Economy" value={num(w.economy)} /><Stat label="Average" value={num(w.average)} />
            <Stat label="Runs" value={w.runs} /><Stat label="Maidens" value={w.maidens} /><Stat label="Dots" value={w.dots} />
            <Stat label="3+ wkts" value={w.threeWickets} /><Stat label="Catches" value={c.fielding.catches} /><Stat label="POTM" value={c.playerOfMatch} />
          </Card>
          <SectionTitle>Match by match</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left font-medium">Match</th><th className="text-left font-medium">Batting</th><th className="text-left font-medium">Bowling</th><th className="pr-4 text-right font-medium">Field</th></tr></thead>
              <tbody>
                {data.player.matches.map((m) => (
                  <tr key={m.match} className="border-t border-slate-100">
                    <td className="px-4 py-2"><Link to={`/matches/${m.match}`} className="hover:text-brand">#{m.matchNumber} vs {m.opponent?.shortName}</Link><p className="text-xs text-slate-500">{fmtDate(m.date)}{m.playerOfMatch && ' · POTM'}</p></td>
                    <td className="tnum">{m.batting ? `${m.batting.runs}${m.batting.out ? '' : '*'} (${m.batting.balls})` : <span className="text-slate-400">DNB</span>}</td>
                    <td className="tnum">{m.bowling ? `${m.bowling.wickets}/${m.bowling.runs} (${m.bowling.overs})` : <span className="text-slate-400">-</span>}</td>
                    <td className="pr-4 text-right tnum">{m.fielding?.catches ? `${m.fielding.catches}c` : ''}{m.fielding?.runOuts ? ` ${m.fielding.runOuts}ro` : ''}{m.fielding?.stumpings ? ` ${m.fielding.stumpings}st` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
