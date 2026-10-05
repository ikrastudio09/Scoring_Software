import { useEffect, useRef, useState } from 'react';
import { BallChip, Card, PlayerLink, TeamLogo } from './ui.jsx';
import { num } from '../lib/format.js';

function Batter({ b, onStrike }) {
  if (!b) return <tr><td colSpan={6} className="py-1.5 text-slate-400">—</td></tr>;
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-2">
        <PlayerLink id={b.id} className="font-medium text-slate-900">{b.name}</PlayerLink>
        {onStrike && <span className="ml-1 text-brand" title="On strike">*</span>}
      </td>
      <td className="text-right font-semibold tnum">{b.runs}</td>
      <td className="text-right text-slate-500 tnum">{b.balls}</td>
      <td className="text-right text-slate-500 tnum">{b.fours}</td>
      <td className="text-right text-slate-500 tnum">{b.sixes}</td>
      <td className="text-right text-slate-500 tnum">{num(b.sr, 1)}</td>
    </tr>
  );
}

/** Full live view of a match (viewer receives updates after overs, wickets and major events). */
export default function LivePanel({ live, flashKey }) {
  const [flash, setFlash] = useState(false);
  const firstKey = useRef(flashKey);
  useEffect(() => {
    if (!flashKey || flashKey === firstKey.current) return undefined;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(t);
  }, [flashKey]);

  if (!live) return null;
  const c = live.current;
  const teams = live.teams;
  const first = live.innings[0];

  if (!c) {
    return (
      <Card className="p-6 text-center text-sm text-slate-600">
        {live.match?.toss
          ? `${teams[live.match.toss.winner]?.name} won the toss and chose to ${live.match.toss.decision}. Play will start soon.`
          : 'The match has not started yet.'}
      </Card>
    );
  }
  const batting = teams[c.battingTeam];
  return (
    <div className="space-y-3">
      <Card className={`overflow-hidden ${flash ? 'flash' : ''}`}>
        <div className="flex items-center gap-3 p-4">
          <TeamLogo team={batting} size="h-12 w-12 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-600">{batting?.name}{c.inningsNumber === 2 && ' · chasing'}</p>
            <p className="tnum text-4xl font-black tracking-tight text-slate-900">
              <span data-testid="live-score">{c.runs}/{c.wickets}</span>
              <span className="ml-2 text-lg font-semibold text-slate-500">({c.overs}/{c.maxOvers})</span>
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>CRR <span className="font-semibold text-slate-800 tnum">{num(c.crr)}</span></p>
            {c.rrr !== null && <p className="mt-0.5">RRR <span className="font-semibold text-slate-800 tnum">{num(c.rrr)}</span></p>}
          </div>
        </div>
        {c.inningsNumber === 2 && first && (
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-sm text-slate-700">
            {live.result
              ? <span className="font-semibold text-emerald-700">{live.result.text}</span>
              : c.status === 'IN_PROGRESS'
                ? <>Need <b className="tnum">{c.runsNeeded}</b> from <b className="tnum">{c.ballsRemaining}</b> balls · Target <b className="tnum">{c.target}</b></>
                : null}
            <span className="ml-2 text-xs text-slate-500">{teams[first.battingTeam]?.shortName} {first.runs}/{first.wickets} ({first.overs})</span>
          </div>
        )}
        {c.inningsNumber === 1 && live.state === 'INNINGS_BREAK' && (
          <div className="border-t border-slate-100 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">
            Innings break · {teams[live.innings[0].bowlingTeam]?.name} need {c.runs + 1} to win
          </div>
        )}
        {live.result && c.inningsNumber === 1 && (
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-emerald-700">{live.result.text}</div>
        )}
        {c.freeHit && live.state === 'IN_PROGRESS' && (
          <div className="bg-accent px-4 py-1 text-center text-xs font-bold uppercase tracking-widest text-white">Free hit</div>
        )}
      </Card>

      {live.state === 'IN_PROGRESS' && (
        <Card className="p-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr><th className="pb-1 text-left font-medium">Batter</th><th className="text-right font-medium">R</th><th className="text-right font-medium">B</th><th className="text-right font-medium">4s</th><th className="text-right font-medium">6s</th><th className="text-right font-medium">SR</th></tr>
            </thead>
            <tbody>
              <Batter b={c.striker} onStrike />
              <Batter b={c.nonStriker} />
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <span>
              <span className="text-xs text-slate-500">Bowler </span>
              {c.bowler ? <PlayerLink id={c.bowler.id} className="font-medium">{c.bowler.name}</PlayerLink> : <span className="text-slate-400">Between overs</span>}
            </span>
            {c.bowler && <span className="tnum text-slate-700">{c.bowler.overs}-{c.bowler.maidens}-{c.bowler.runs}-{c.bowler.wickets}</span>}
          </div>
          {(c.partnership || c.lastWicket) && (
            <div className="mt-3 grid gap-1 border-t border-slate-100 pt-3 text-xs text-slate-600 sm:grid-cols-2">
              {c.partnership && <p>Partnership <b className="tnum text-slate-800">{c.partnership.runs}</b> ({c.partnership.balls})</p>}
              {c.lastWicket && <p>Last wkt: <b className="text-slate-800">{c.lastWicket.name}</b> {c.lastWicket.runs} ({c.lastWicket.balls}) · {c.lastWicket.score}</p>}
            </div>
          )}
        </Card>
      )}

      {(c.thisOver.balls.length > 0 || c.recentOvers.length > 0) && (
        <Card className="p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recent overs</p>
          <div className="space-y-2">
            {[...c.recentOvers.filter((o) => o.over !== c.thisOver.over)].slice(-3).concat(c.thisOver.balls.length ? [c.thisOver] : []).reverse().map((o) => (
              <div key={o.over} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-slate-500">Ov {o.over}</span>
                <div className="flex flex-1 flex-wrap gap-1">{o.balls.map((b, i) => <BallChip key={i} label={b} size="h-7 min-w-7 text-[11px]" />)}</div>
                <span className="tnum text-xs font-semibold text-slate-700">{o.runs}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
