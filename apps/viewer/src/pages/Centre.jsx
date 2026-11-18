// Tournament Centre: one category's totals, records and leaderboards. Tables and tiles only.
import { useEffect } from 'react';
import { formatNrr } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { CatLink, useCategory } from '../lib/category.jsx';
import { Card, Empty, ErrorState, SectionTitle, Spinner, TeamDot } from '../components/ui.jsx';
import { CapTable } from './Stats.jsx';
import { num } from '../lib/format.js';

const playerLink = (p) => (
  <CatLink key={`${p.playerId}-${p.match || ''}`} to={`/players/${p.playerId}`} className="inline-flex items-center gap-1.5 font-medium hover:text-brand">
    <TeamDot color={p.teamInfo?.color} size="h-2 w-2" />{p.name}
  </CatLink>
);
const teamLink = (t) => (
  <CatLink key={t.id} to={`/teams/${t.id}`} className="inline-flex items-center gap-1.5 font-medium hover:text-brand">
    <TeamDot color={t.color} size="h-2 w-2" />{t.name}
  </CatLink>
);
const matchNote = (x) => (x.matchNumber ? ` · Match ${x.matchNumber}` : '');

// [label, holders → value text, holders → who (nodes), holders → detail]
const PLAYER_RECORDS = [
  ['Highest individual score', 'highestIndividualScore', (r) => `${r.runs}${r.out ? '' : '*'}`, (r) => `${r.balls} balls${matchNote(r)}`],
  ['Best bowling', 'bestBowling', (r) => `${r.wickets}/${r.runs}`, (r) => `${r.overs} ov${matchNote(r)}`],
  ['Most runs', 'mostRuns', (r) => r.runs, (r) => `${r.innings} inns · SR ${num(r.strikeRate, 1)}`],
  ['Most wickets', 'mostWickets', (r) => r.wickets, (r) => `econ ${num(r.economy)}`],
  ['Most fours', 'mostFours', (r) => r.batting.fours, () => ''],
  ['Most sixes', 'mostSixes', (r) => r.batting.sixes, () => ''],
  ['Most catches', 'mostCatches', (r) => r.fielding.catches, () => ''],
  ['Best batting average', 'bestBattingAverage', (r) => num(r.batting.average), (r) => `${r.batting.runs} runs`],
  ['Best strike rate', 'bestStrikeRate', (r) => num(r.batting.strikeRate, 1), (r) => `${r.batting.runs} off ${r.batting.balls}`],
  ['Best economy', 'bestEconomy', (r) => num(r.bowling.economy), (r) => `${r.bowling.overs} ov`],
  ['Most valuable player', 'mostValuablePlayer', (r) => Math.round(r.impact.total), (r) => `impact · ${r.matches} matches`],
];
const TEAM_RECORDS = [
  ['Highest team total', 'highestTotal', (r) => `${r.runs}/${r.wickets}`, (r) => `${r.overs} ov${matchNote(r)}`],
  ['Lowest completed total', 'lowestTotal', (r) => `${r.runs}/${r.wickets}`, (r) => `${r.overs} ov${matchNote(r)}`],
  ['Highest successful chase', 'highestChase', (r) => `${r.runs}/${r.wickets}`, (r) => `target ${r.target}, ${r.overs} ov${matchNote(r)}`],
  ['Biggest win (runs)', 'biggestWinByRuns', (r) => `${r.runs} runs`, (r) => `v ${r.loser.shortName}${matchNote(r)}`],
  ['Biggest win (wickets)', 'biggestWinByWickets', (r) => `${r.wickets} wkts`, (r) => `${r.ballsRemaining} balls to spare${matchNote(r)}`],
  ['Most wins', 'mostWins', (r) => r.wins, (r) => `${r.played} played`],
  ['Most points', 'mostPoints', (r) => r.points, (r) => `${r.played} played`],
  ['Best net run rate', 'bestNrr', (r) => formatNrr(r.nrr), (r) => `${r.played} played`],
  ['Longest winning streak', 'longestWinningStreak', (r) => `${r.wins} in a row`, (r) => (r.current === r.wins ? 'ongoing' : '')],
];

function RecordCard({ title, defs, data, who }) {
  return (
    <Card className="overflow-hidden">
      <h3 className="bg-slate-50 px-4 py-2.5 text-sm font-semibold">{title}</h3>
      <dl>
        {defs.map(([label, key, value, detail]) => {
          const holders = data[key] || [];
          return (
            <div key={key} className="flex items-start gap-3 border-t border-slate-100 px-4 py-2.5 text-sm">
              <dt className="w-24 shrink-0 text-xs text-slate-500 sm:w-44">{label}</dt>
              {holders.length ? (
                <dd className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">{holders.map(who)}</div>
                  {detail(holders[0]) && <p className="text-xs text-slate-500">{holders.length > 1 ? `${holders.length} share this record · ` : ''}{detail(holders[0])}</p>}
                </dd>
              ) : <dd className="flex-1 text-slate-400">–</dd>}
              {holders.length > 0 && <span className="tnum shrink-0 font-bold">{value(holders[0])}</span>}
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function MiniBoard({ title, rows, value, sub }) {
  return (
    <Card className="overflow-hidden">
      <h3 className="bg-slate-50 px-4 py-2.5 text-sm font-semibold">{title}</h3>
      {!rows?.length ? <p className="px-4 py-3 text-sm text-slate-500">After the first result.</p> : (
        <ol>
          {rows.map((p) => (
            <li key={p.playerId} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-sm">
              <span className={`w-6 text-xs tnum ${p.rank === 1 ? 'font-bold text-brand' : 'text-slate-400'}`}>{p.rank}{p.tied ? '=' : ''}</span>
              <span className="min-w-0 flex-1 truncate">{playerLink(p)} <span className="text-xs text-slate-400">{sub?.(p)}</span></span>
              <span className="tnum font-bold">{value(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

export default function Centre() {
  const { scoped, key, category } = useCategory();
  const { data, error, reload } = useApi(api, scoped('/tournament-centre'));
  useEffect(() => live.onTournament((e) => {
    if ((e.type === 'STATISTICS_UPDATED' && (!e.category || e.category === key)) || e.type === 'MATCH_STATUS_CHANGED') reload();
  }), [reload, key]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const o = data.overview;
  const lb = data.leaderboards;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{category?.name}</p>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Tournament Centre</h1>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[['Played', `${o.completed}/${o.totalMatches}`], ['Remaining', o.remaining], ['Runs', o.runs], ['Wickets', o.wickets], ['Fours', o.fours], ['Sixes', o.sixes], ['Extras', o.extras], ['Overs', o.overs], ['50+ scores', o.fifties]].map(([k, v]) => (
          <Card key={k} className="p-3 text-center"><p className="tnum text-xl font-black">{v}</p><p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p></Card>
        ))}
      </div>

      {!o.completed ? <div className="mt-4"><Empty>Records and leaderboards appear after the first result is confirmed.</Empty></div> : (
        <>
          <SectionTitle>Records</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <RecordCard title="Player records" defs={PLAYER_RECORDS} data={data.records} who={playerLink} />
            <RecordCard title="Team records" defs={TEAM_RECORDS} data={data.teamRecords} who={(r) => teamLink(r.team || r.winner)} />
          </div>

          <SectionTitle action={<CatLink to="/stats" className="text-sm font-medium text-brand">All statistics</CatLink>}>Leaderboards</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <CapTable kind="orange" cap={lb.orangeCap} limit={5} />
            <CapTable kind="purple" cap={lb.purpleCap} limit={5} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MiniBoard title="MVP" rows={lb.mvp} value={(p) => Math.round(p.impact.total)} sub={(p) => `${p.matches} m`} />
            <MiniBoard title="Batting" rows={lb.batting} value={(p) => p.batting.runs} sub={(p) => `SR ${num(p.batting.strikeRate, 1)}`} />
            <MiniBoard title="Bowling" rows={lb.bowling} value={(p) => p.bowling.wickets} sub={(p) => `econ ${num(p.bowling.economy)}`} />
            <MiniBoard title="Fielding" rows={lb.fielding} value={(p) => p.fielding.catches + p.fielding.runOuts + p.fielding.stumpings} sub={(p) => `${p.fielding.catches}c ${p.fielding.runOuts}ro ${p.fielding.stumpings}st`} />
          </div>
        </>
      )}

      <CatLink to="/qualification" className="mt-4 block">
        <Card className="flex items-center justify-between p-4 text-sm hover:ring-brand/40"><span><b>Qualification scenarios</b> <span className="text-slate-500">· who is through, who must win, what-if</span></span><span className="font-semibold text-brand">→</span></Card>
      </CatLink>

      <PreviousSeasons />
    </div>
  );
}

const names = (list) => (list?.length ? list.map((x) => x.name || x).join(', ') : '–');
const withValue = (list) => (list?.length ? `${names(list)} (${list[0].value})` : '–');

/** Earlier seasons of this category (imported records), loaded after the rest of the page. */
function PreviousSeasons() {
  const { scoped, category } = useCategory();
  const { data } = useApi(api, scoped('/history'));
  return (
    <>
      <SectionTitle>Previous seasons</SectionTitle>
      {!data ? <Spinner /> : !data.available ? (
        <Card className="p-4 text-sm text-slate-500">Earlier MPL seasons of the {category?.name} tournament appear here once their records have been imported.</Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr><th className="px-4 py-2 text-left font-medium">Season</th><th className="text-left font-medium">Champions</th><th className="text-left font-medium">Runners-up</th><th className="text-left font-medium">Most runs</th><th className="text-left font-medium">Most wickets</th><th className="text-left font-medium">MVP</th><th className="pr-4 text-right font-medium">Highest total</th></tr>
              </thead>
              <tbody>
                {data.seasons.map((s) => (
                  <tr key={s.season} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2 font-medium">Season {s.season}</td>
                    <td className="py-2 font-semibold">{names(s.champion)}</td>
                    <td className="py-2">{names(s.runnerUp)}</td>
                    <td className="py-2 text-xs">{withValue(s.topRunScorer)}</td>
                    <td className="py-2 text-xs">{withValue(s.topWicketTaker)}</td>
                    <td className="py-2 text-xs">{names(s.mvp)}</td>
                    <td className="tnum py-2 pr-4 text-right">{s.highestTotal.length ? s.highestTotal[0].value : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[['Most runs (earlier seasons)', data.allTime.mostRuns], ['Most wickets (earlier seasons)', data.allTime.mostWickets], ['Most matches', data.allTime.mostMatches], ['Most titles', data.allTime.mostTitles]].map(([title, rows]) => (
              <Card key={title} className="overflow-hidden">
                <h3 className="bg-slate-50 px-4 py-2.5 text-sm font-semibold">{title}</h3>
                {!rows.length ? <p className="px-4 py-3 text-sm text-slate-500">–</p> : (
                  <ol>{rows.slice(0, 5).map((r, i, list) => (
                    <li key={`${r.name}-${i}`} className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-sm">
                      {/* level values share a place */}
                      <span className="w-5 text-xs text-slate-400 tnum">{list.findIndex((x) => x.value === r.value) + 1}{list.filter((x) => x.value === r.value).length > 1 ? '=' : ''}</span><span className="min-w-0 flex-1 truncate">{r.name}{r.seasons ? <span className="text-xs text-slate-400"> · {r.seasons} seasons</span> : null}</span><b className="tnum">{r.value}</b>
                    </li>
                  ))}</ol>
                )}
              </Card>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">From imported records of earlier seasons; the current season is shown live above.</p>
        </>
      )}
    </>
  );
}
