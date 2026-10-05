import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Card, Empty, ErrorState, Spinner, Tabs, TeamDot } from '../components/ui.jsx';
import { num } from '../lib/format.js';

const BOARDS = {
  batting: [
    ['mostRuns', 'Most runs', (p) => p.batting.runs, (p) => `${p.batting.innings} inns · avg ${num(p.batting.average)} · SR ${num(p.batting.strikeRate, 1)} · HS ${p.batting.highestText}`],
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
    ['mostDots', 'Most dot balls', (p) => p.bowling.dots, (p) => `${p.bowling.overs} overs`],
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

export default function Stats() {
  const [tab, setTab] = useState('batting');
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
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'batting', label: 'Batting' }, { value: 'bowling', label: 'Bowling' }, { value: 'other', label: 'Fielding & awards' }]} />
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {BOARDS[tab].map(([key, title, value, detail]) => <Board key={key} title={title} rows={data[key] || []} value={value} detail={detail} note={notes[key]} />)}
      </div>
    </div>
  );
}
