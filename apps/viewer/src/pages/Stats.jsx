import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Avatar, Card, Empty, ErrorState, Spinner, Tabs, TeamDot } from '../components/ui.jsx';
import { num } from '../lib/format.js';

const BOARDS = {
  batting: [
    ['mostRuns', 'Most runs', (p) => p.batting.runs, (p) => `${p.batting.innings} inns · avg ${num(p.batting.average)} · SR ${num(p.batting.strikeRate, 1)} · HS ${p.batting.highestText} · ${num(p.batting.boundaryPct, 1)}% boundaries`],
    ['highestScores', 'Highest scores', (p) => `${p.runs}${p.out ? '' : '*'}`, (p) => `${p.balls} balls · ${p.fours}×4 ${p.sixes}×6 · Match ${p.matchNumber}`],
    ['bestStrikeRate', 'Best strike rate', (p) => num(p.batting.strikeRate, 1), (p) => `${p.batting.runs} runs off ${p.batting.balls}`],
    ['bestBattingAverage', 'Best average', (p) => num(p.batting.average), (p) => `${p.batting.runs} runs · ${p.batting.innings} inns`],
    ['mostSixes', 'Most sixes', (p) => p.batting.sixes, (p) => `${p.batting.runs} runs`],
    ['mostFours', 'Most fours', (p) => p.batting.fours, (p) => `${p.batting.runs} runs`],
  ],
  bowling: [
    ['mostWickets', 'Most wickets', (p) => p.bowling.wickets, (p) => `${p.bowling.overs} ov · econ ${num(p.bowling.economy)} · best ${p.bowling.bestText}`],
    ['bestBowling', 'Best figures', (p) => `${p.wickets}/${p.runs}`, (p) => `${p.overs} overs · Match ${p.matchNumber}`],
    ['bestEconomy', 'Best economy', (p) => num(p.bowling.economy), (p) => `${p.bowling.overs} ov · ${p.bowling.wickets} wkts`],
    ['mostDots', 'Most dot balls', (p) => p.bowling.dots, (p) => `${p.bowling.overs} overs · ${num(p.bowling.dotPct, 1)}% dots`],
  ],
  other: [
    ['mostCatches', 'Most catches', (p) => p.fielding.catches, (p) => `${p.matches} matches`],
    ['mostPlayerOfMatch', 'Player of the match awards', (p) => p.playerOfMatch, (p) => `${p.matches} matches`],
  ],
};

function Board({ title, rows, value, detail, note }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between bg-slate-50 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <span className="text-[11px] text-slate-500">{note}</span>}
      </div>
      {!rows.length ? <p className="px-4 py-4 text-sm text-slate-500">No qualifying players yet.</p> : (
        <ol>
          {rows.map((p, i) => (
            <li key={`${p.playerId}-${i}`} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5">
              <span className={`w-5 text-sm tnum ${i === 0 ? 'font-bold text-brand' : 'text-slate-400'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <Link to={`/players/${p.playerId}`} className="flex items-center gap-2 font-medium hover:text-brand">
                  <TeamDot color={p.teamInfo?.color} size="h-2.5 w-2.5" /><span className="truncate">{p.name}</span>
                  <span className="text-xs font-normal text-slate-500">{p.teamInfo?.shortName}</span>
                </Link>
                <p className="truncate text-xs text-slate-500">{detail(p)}</p>
              </div>
              <span className={`tnum text-lg font-bold ${i === 0 ? 'text-brand' : 'text-slate-800'}`}>{value(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

const MVP_SORT = {
  overall: ['Overall', (p) => p.impact.total],
  batting: ['Batting', (p) => p.impact.batting],
  bowling: ['Bowling', (p) => p.impact.bowling],
  fielding: ['Fielding', (p) => p.impact.fielding],
};

/** Tournament MVP: ranked by impact. Auction value plays no part in it. */
function MvpBoard() {
  const { data, error, reload } = useApi(api, '/stats/mvp');
  const [by, setBy] = useState('overall');
  useEffect(() => live.onTournament((e) => { if (e.type === 'STATISTICS_UPDATED') reload(); }), [reload]);
  const rows = useMemo(() => {
    if (!data) return [];
    const f = MVP_SORT[by][1];
    return [...data.players].filter((p) => f(p) > 0).sort((a, b) => f(b) - f(a)).slice(0, 30);
  }, [data, by]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const f = MVP_SORT[by][1];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(MVP_SORT).map(([k, [label]]) => (
          <button key={k} type="button" onClick={() => setBy(k)} className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition ${by === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300 hover:ring-slate-400'}`}>{label}</button>
        ))}
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 py-2 pl-4 text-left font-medium">#</th><th className="text-left font-medium">Player</th>
              <th className="text-right font-medium">M</th><th className="text-right font-medium">Runs</th><th className="text-right font-medium">Wkts</th>
              <th className="text-right font-medium">Field</th><th className="text-right font-medium">MVP</th><th className="pr-4 text-right font-semibold text-slate-700">Impact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.playerId} className="border-t border-slate-100">
                <td className={`py-2 pl-4 tnum ${i < 3 ? 'font-bold text-brand' : 'text-slate-400'}`}>{i + 1}</td>
                <td>
                  <Link to={`/players/${p.playerId}`} className="flex items-center gap-2 py-1 font-medium hover:text-brand">
                    <Avatar name={p.name} photoUrl={p.photoUrl} color={p.teamInfo?.color} size="h-8 w-8 text-[10px]" />
                    <span className="min-w-0"><span className="block truncate">{p.name}</span><span className="text-xs font-normal text-slate-500">{p.teamInfo?.shortName}</span></span>
                  </Link>
                </td>
                <td className="text-right tnum text-slate-600">{p.matches}</td>
                <td className="text-right tnum">{p.runs}</td>
                <td className="text-right tnum">{p.wickets}</td>
                <td className="text-right tnum">{p.fielding}</td>
                <td className="text-right tnum">{p.mvpAwards || ''}</td>
                <td className="pr-4 text-right text-base font-black tnum">{Math.round(f(p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-6 text-center text-sm text-slate-500">No qualifying players yet.</p>}
      </Card>
      {data.valueForMoney.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-1 bg-slate-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold">Value for money</h3>
            <span className="text-[11px] text-slate-500">impact per 100k auction points · min {data.valueMinMatches} matches · not used for MVP</span>
          </div>
          <ol>
            {data.valueForMoney.slice(0, 10).map((p, i) => (
              <li key={p.playerId} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2.5">
                <span className="w-5 text-sm text-slate-400 tnum">{i + 1}</span>
                <Link to={`/players/${p.playerId}`} className="min-w-0 flex-1 truncate font-medium hover:text-brand">
                  {p.name} <span className="text-xs font-normal text-slate-500">{p.teamInfo?.shortName} · {p.soldPoints.toLocaleString()} pts · impact {Math.round(p.impact.total)}</span>
                </Link>
                <span className="tnum font-bold">{num(p.valuePer100k, 1)}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="text-xs text-slate-500">
        Impact = runs (plus boundary and milestone bonuses, and credit for scoring faster than the match rate) + wickets (top-order bonus),
        dots and maidens (plus credit for economy better than the match rate) + catches, run outs and stumpings + a bonus for a winning
        chase or defence. Ranked by total impact; ties by MVP awards.
      </p>
    </div>
  );
}

export default function Stats() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'batting';
  const setTab = (t) => setParams({ tab: t }, { replace: true });
  const { data, error, reload } = useApi(api, '/stats/leaderboards');
  useEffect(() => live.onTournament((e) => { if (e.type === 'STATISTICS_UPDATED') reload(); }), [reload]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const q = data.qualify;
  const notes = { bestStrikeRate: `min ${q.strikeRateMinBalls} balls`, bestEconomy: `min ${q.economyMinBalls / 6} overs`, bestBattingAverage: `min ${q.averageMinInnings} inns` };

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Statistics</h1>
      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[['Matches', data.totals.matches], ['Runs', data.totals.runs], ['Wickets', data.totals.wickets], ['Fours', data.totals.fours], ['Sixes', data.totals.sixes], ['50+ scores', data.totals.fifties]].map(([k, v]) => (
          <Card key={k} className="p-3 text-center"><p className="tnum text-xl font-black">{v}</p><p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p></Card>
        ))}
      </div>
      {!data.totals.matches && <Empty>Statistics appear after the first result is confirmed.</Empty>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'mvp', label: 'MVP' }, { value: 'batting', label: 'Batting' }, { value: 'bowling', label: 'Bowling' }, { value: 'other', label: 'Fielding & awards' }]} />
      <div className="mt-4">
        {tab === 'mvp' ? <MvpBoard /> : (
          <div className="grid gap-4 md:grid-cols-2">
            {(BOARDS[tab] || BOARDS.batting).map(([key, title, value, detail]) => <Board key={key} title={title} rows={data[key] || []} value={value} detail={detail} note={notes[key]} />)}
          </div>
        )}
      </div>
    </div>
  );
}
