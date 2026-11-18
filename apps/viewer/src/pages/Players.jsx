import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Avatar, Card, Empty, ErrorState, SectionTitle, Spinner } from '../components/ui.jsx';
import { fmtDate, num } from '../lib/format.js';
import { CatLink, useCategory, useCategoryGuard } from '../lib/category.jsx';

const ROLE = { batter: 'Batter', bowler: 'Bowler', allrounder: 'All-rounder', wicketkeeper: 'Wicket-keeper' };
const typeOf = (p) => p.playerType || ROLE[p.role];

export function Players() {
  const cat = useCategory();
  const { data, error, reload } = useApi(api, cat.scoped('/players'));
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
          <CatLink key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
            <Avatar name={p.name} photoUrl={p.photoUrl} color={p.team.color} size="h-9 w-9 text-[11px]" />
            <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
            <span className="text-xs text-slate-500">{p.team.shortName} · {typeOf(p)}</span>
          </CatLink>
        ))}
      </Card>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="p-3 text-center">
      <p className={`tnum text-lg ${strong ? 'font-black text-slate-900' : 'font-bold'}`}>{value ?? '-'}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}

// Columns of the per-season table: [label, value(totals, rates)]. A value that the source did not
// supply shows "–" (never 0), and rates appear only when real denominators exist.
const PERIOD_COLS = [
  ['M', (t) => t.matches], ['Runs', (t) => t.runs], ['Avg', (t, r) => num(r.battingAvg)], ['SR', (t, r) => num(r.strikeRate, 1)],
  ['4s/6s', (t) => (t.fours !== undefined || t.sixes !== undefined ? `${t.fours ?? '–'}/${t.sixes ?? '–'}` : undefined)],
  ['Wkts', (t) => t.wickets], ['Econ', (t, r) => num(r.economy)], ['Ct', (t) => t.catches], ['MOM', (t) => t.playerOfMatch],
];

/** This season, last season, all seasons before it, and the career total — four separate rows. */
function PeriodTable({ history }) {
  const rows = [history.currentSeason, history.previousYear, history.overallPrevious].filter(Boolean);
  if (!rows.length) return null;
  const career = history.career && rows.length > 1 ? history.career : null;
  const cell = (v) => (v === undefined || v === null || v === '-' ? <span className="text-slate-300">–</span> : v);
  return (
    <>
      <SectionTitle>Performance by season</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-4 py-2 text-left font-medium">Period</th>{PERIOD_COLS.map(([h]) => <th key={h} className="px-2 text-right font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.label} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">{b.label}{b.totals.seasons > 1 && <span className="ml-1 text-xs font-normal text-slate-500">({b.totals.seasons} seasons)</span>}</td>
                {PERIOD_COLS.map(([h, f]) => <td key={h} className="tnum px-2 text-right">{cell(f(b.totals, b.rates))}</td>)}
              </tr>
            ))}
            {career && (
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="px-4 py-2">Career{career.totals.seasons ? <span className="ml-1 text-xs font-normal text-slate-500">({career.totals.seasons} seasons)</span> : null}</td>
                {PERIOD_COLS.map(([h, f]) => <td key={h} className="tnum px-2 text-right">{cell(f(career.totals, career.rates))}</td>)}
              </tr>
            )}
          </tbody>
        </table>
        {career?.partial?.length > 0 && (
          <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Career shows only figures recorded for every period; earlier seasons do not include balls, innings or boundaries, so those career totals and rates are not shown.</p>
        )}
        {career?.notes?.map((n) => <p key={n} className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">{n}</p>)}
      </Card>
    </>
  );
}

/** Earlier seasons with their own records (imported files, or scored in this system). */
function SeasonTable({ seasons }) {
  if (!seasons?.length) return null;
  const cell = (v) => (v === undefined || v === null || v === '-' ? <span className="text-slate-300">–</span> : v);
  return (
    <>
      <SectionTitle>Season by season</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-4 py-2 text-left font-medium">Season</th><th className="text-left font-medium">Team</th>{PERIOD_COLS.map(([h]) => <th key={h} className="px-2 text-right font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.season} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">Season {s.season}{s.mvpAward && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-900">MVP</span>}</td>
                <td className="text-xs text-slate-600">{s.team || '–'}</td>
                {PERIOD_COLS.map(([h, f]) => <td key={h} className="tnum px-2 text-right">{cell(f(s.totals, s.rates))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">From imported MPL records{seasons.some((s) => s.source === 'scored') ? ' and seasons scored in this system' : ''}.</p>
      </Card>
    </>
  );
}

function Awards({ a }) {
  if (!a) return null;
  const chips = [
    a.orangeCap && ['Orange Cap', 'bg-orange-500'],
    a.purpleCap && ['Purple Cap', 'bg-purple-600'],
    a.playerOfMatch > 0 && [`${a.playerOfMatch}× Player of the match`, 'bg-white/15'],
    a.mvpAwards > 0 && [`${a.mvpAwards}× Match MVP`, 'bg-white/15'],
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-5 py-2.5">
      {chips.map(([label, cls]) => <span key={label} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white ${cls}`}>{label}</span>)}
    </div>
  );
}

export function PlayerPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi(api, `/players/${id}`, [id]);
  useCategoryGuard(data?.player?.category);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const p = data.player;
  const c = p.career;
  const b = c?.batting;
  const w = c?.bowling;
  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-2xl bg-slate-950 text-white">
        <div className="h-1.5" style={{ background: p.team.color }} />
        <div className="flex items-center gap-4 p-5">
          <Avatar name={p.name} photoUrl={p.photoUrl} color={p.team.color} size="h-20 w-20 text-xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-black tracking-tight">{p.name}</h1>
            <p className="text-sm text-white/70"><CatLink to={`/teams/${p.team.id}`} className="hover:text-white">{p.team.name}</CatLink> · {typeOf(p)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(p.playingStyle?.length ? p.playingStyle : [`${p.battingStyle === 'left' ? 'Left' : 'Right'}-hand bat`, p.bowlingStyle].filter(Boolean)).map((s) => (
                <span key={s} className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/80">{s.replace('Balling', 'Bowling')}</span>
              ))}
            </div>
          </div>
          {c?.matches > 0 && (
            <div className="hidden text-right sm:block">
              <p className="tnum text-3xl font-black leading-none">{Math.round(c.impact.total)}</p>
              <p className="text-[11px] uppercase tracking-wide text-white/50">impact{c.mvpRank ? ` · #${c.mvpRank}` : ''}</p>
            </div>
          )}
        </div>
        {(p.auction || c?.matches > 0) && (
          <div className="grid grid-cols-3 border-t border-white/10 text-center text-xs sm:grid-cols-4">
            {p.auction && <div className="p-3"><p className="tnum text-base font-bold">{p.auction.soldPoints.toLocaleString()}</p><p className="text-white/50">auction points</p></div>}
            {c?.matches > 0 && <div className="p-3"><p className="tnum text-base font-bold">{c.mvpAwards}</p><p className="text-white/50">MVP awards</p></div>}
            {c?.matches > 0 && <div className="p-3"><p className="tnum text-base font-bold">{c.impactPerMatch}</p><p className="text-white/50">impact / match</p></div>}
            {c?.valuePer100k !== null && c?.valuePer100k !== undefined && <div className="p-3"><p className="tnum text-base font-bold">{num(c.valuePer100k, 1)}</p><p className="text-white/50">impact / 100k</p></div>}
          </div>
        )}
        <Awards a={p.awards} />
      </div>

      {p.history && <PeriodTable history={p.history} />}
      {p.history && <SeasonTable seasons={p.history.seasons} />}

      {!c || !c.matches ? <Empty>No matches played this season yet.</Empty> : (
        <>
          <SectionTitle>This season — batting</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6">
            <Stat label="Matches" value={c.matches} /><Stat label="Innings" value={b.innings} /><Stat label="Runs" value={b.runs} strong />
            <Stat label="Highest" value={b.highestText} /><Stat label="Average" value={num(b.average)} /><Stat label="Strike rate" value={num(b.strikeRate, 1)} />
            <Stat label="Not outs" value={b.notOuts} /><Stat label="4s" value={b.fours} /><Stat label="6s" value={b.sixes} />
            <Stat label="50s" value={b.fifties + b.hundreds} /><Stat label="Dot %" value={num(b.dotPct, 1)} /><Stat label="Boundary %" value={num(b.boundaryPct, 1)} />
          </Card>
          <SectionTitle>This season — bowling</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6">
            <Stat label="Innings" value={w.innings} /><Stat label="Overs" value={w.overs} /><Stat label="Wickets" value={w.wickets} strong />
            <Stat label="Best" value={w.bestText} /><Stat label="Economy" value={num(w.economy)} /><Stat label="Average" value={num(w.average)} />
            <Stat label="Strike rate" value={num(w.strikeRate, 1)} /><Stat label="Maidens" value={w.maidens} /><Stat label="Dots" value={w.dots} />
            <Stat label="Dot %" value={num(w.dotPct, 1)} /><Stat label="4s/6s given" value={w.boundariesConceded} /><Stat label="3+ wkts" value={w.threeWickets} />
          </Card>
          <SectionTitle>Fielding & impact</SectionTitle>
          <Card className="grid grid-cols-3 divide-x divide-y divide-slate-100 sm:grid-cols-6">
            <Stat label="Catches" value={c.fielding.catches} /><Stat label="Run outs" value={c.fielding.runOuts} /><Stat label="Stumpings" value={c.fielding.stumpings} />
            <Stat label="Bat impact" value={Math.round(c.impact.batting)} /><Stat label="Bowl impact" value={Math.round(c.impact.bowling)} /><Stat label="Field impact" value={Math.round(c.impact.fielding)} />
          </Card>
          <SectionTitle>Match by match</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-2 text-left font-medium">Match</th><th className="text-left font-medium">Batting</th><th className="text-left font-medium">Bowling</th><th className="text-right font-medium">Field</th><th className="pr-4 text-right font-medium">Impact</th></tr></thead>
              <tbody>
                {data.player.matches.map((m) => (
                  <tr key={m.match} className="border-t border-slate-100">
                    <td className="px-4 py-2"><CatLink to={`/matches/${m.match}`} className="hover:text-brand">#{m.matchNumber} vs {m.opponent?.shortName}</CatLink><p className="text-xs text-slate-500">{fmtDate(m.date)}{m.playerOfMatch && ' · POTM'}</p></td>
                    <td className="tnum">{m.batting ? `${m.batting.runs}${m.batting.out ? '' : '*'} (${m.batting.balls})` : <span className="text-slate-400">DNB</span>}</td>
                    <td className="tnum">{m.bowling ? `${m.bowling.wickets}/${m.bowling.runs} (${m.bowling.overs})` : <span className="text-slate-400">-</span>}</td>
                    <td className="text-right tnum">{m.fielding?.catches ? `${m.fielding.catches}c` : ''}{m.fielding?.runOuts ? ` ${m.fielding.runOuts}ro` : ''}{m.fielding?.stumpings ? ` ${m.fielding.stumpings}st` : ''}</td>
                    <td className="pr-4 text-right font-semibold tnum">{Math.round(m.impact ?? 0)}</td>
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
