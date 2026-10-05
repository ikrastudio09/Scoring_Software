import { Card, PlayerLink } from './ui.jsx';
import { num } from '../lib/format.js';

function Innings({ inn }) {
  const e = inn.extras;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between bg-slate-900 px-4 py-2.5 text-white">
        <span className="font-semibold">{inn.battingTeamName}</span>
        <span className="tnum font-bold">{inn.runs}/{inn.wickets} <span className="text-sm font-normal text-slate-300">({inn.overs} ov)</span></span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-4 py-2 text-left font-medium">Batter</th><th className="px-2 text-right font-medium">R</th><th className="px-2 text-right font-medium">B</th><th className="px-2 text-right font-medium">4s</th><th className="px-2 text-right font-medium">6s</th><th className="px-4 text-right font-medium">SR</th></tr>
          </thead>
          <tbody>
            {inn.batting.map((b) => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <PlayerLink id={b.id} className="font-medium text-slate-900">{b.name}</PlayerLink>
                  {b.onStrike && <span className="text-brand"> *</span>}
                  <p className={`text-xs ${b.dismissal === 'not out' ? 'text-emerald-700' : 'text-slate-500'}`}>{b.dismissal}</p>
                </td>
                <td className="px-2 text-right font-semibold tnum">{b.runs}</td>
                <td className="px-2 text-right text-slate-600 tnum">{b.balls}</td>
                <td className="px-2 text-right text-slate-600 tnum">{b.fours}</td>
                <td className="px-2 text-right text-slate-600 tnum">{b.sixes}</td>
                <td className="px-4 text-right text-slate-600 tnum">{num(b.sr, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-slate-100 px-4 py-2.5 text-sm">
        <p><span className="text-slate-500">Extras</span> <b className="tnum">{e.total}</b> <span className="text-xs text-slate-500">(wd {e.wides}, nb {e.noBalls}, b {e.byes}, lb {e.legByes})</span></p>
        <p><span className="text-slate-500">Total</span> <b className="tnum">{inn.runs}/{inn.wickets}</b> <span className="text-xs text-slate-500">({inn.overs} overs, RR {num(inn.runRate)})</span></p>
        {inn.didNotBat.length > 0 && <p className="text-xs text-slate-500">Did not bat: {inn.didNotBat.map((p) => p.name).join(', ')}</p>}
      </div>

      {inn.fallOfWickets.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600">
          <p className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Fall of wickets</p>
          {inn.fallOfWickets.map((f) => <span key={f.wicket} className="mr-3 inline-block tnum">{f.runs}-{f.wicket} ({f.name}, {f.overs})</span>)}
        </div>
      )}

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-4 py-2 text-left font-medium">Bowler</th><th className="px-2 text-right font-medium">O</th><th className="px-2 text-right font-medium">M</th><th className="px-2 text-right font-medium">R</th><th className="px-2 text-right font-medium">W</th><th className="px-2 text-right font-medium">Econ</th><th className="px-2 text-right font-medium">0s</th><th className="px-4 text-right font-medium">Wd/Nb</th></tr>
          </thead>
          <tbody>
            {inn.bowling.map((b) => (
              <tr key={b.id} className="border-t border-slate-100">
                <td className="px-4 py-2"><PlayerLink id={b.id} className="font-medium text-slate-900">{b.name}</PlayerLink></td>
                <td className="px-2 text-right tnum">{b.overs}</td>
                <td className="px-2 text-right tnum">{b.maidens}</td>
                <td className="px-2 text-right tnum">{b.runs}</td>
                <td className="px-2 text-right font-semibold tnum">{b.wickets}</td>
                <td className="px-2 text-right tnum">{num(b.econ)}</td>
                <td className="px-2 text-right tnum">{b.dots}</td>
                <td className="px-4 text-right tnum text-slate-500">{b.wides}/{b.noBalls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inn.partnerships.length > 0 && (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Partnerships</p>
          <div className="space-y-1.5">
            {inn.partnerships.map((p) => (
              <div key={`${p.wicket}-${p.batters.map((b) => b.id).join()}`} className="flex items-center gap-2 text-xs">
                <span className="w-10 text-slate-500">{p.wicket}{['st', 'nd', 'rd'][p.wicket - 1] || 'th'}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{p.batters.map((b) => `${b.name} ${b.runs}(${b.balls})`).join(' & ')}</span>
                <span className="tnum font-semibold">{p.runs}{p.unbroken ? '*' : ''} <span className="font-normal text-slate-500">({p.balls})</span></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export default function Scorecard({ scorecard }) {
  if (!scorecard?.innings?.length) return <p className="py-8 text-center text-sm text-slate-500">Scorecard will appear once play starts.</p>;
  return <div className="space-y-4">{scorecard.innings.map((inn) => <Innings key={inn.number} inn={inn} />)}</div>;
}

export function OversTable({ scorecard }) {
  if (!scorecard?.innings?.length) return null;
  return (
    <div className="space-y-4">
      {scorecard.innings.map((inn) => (
        <Card key={inn.number} className="p-4">
          <p className="mb-3 font-semibold">{inn.battingTeamName}</p>
          <div className="space-y-2">
            {inn.overByOver.map((o) => (
              <div key={o.over} className="flex items-center gap-3 text-sm">
                <span className="w-10 shrink-0 text-xs text-slate-500">Ov {o.over}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{o.bowlers.join(', ')} · {o.balls.join(' ')}</span>
                <span className="w-8 text-right tnum font-semibold">{o.runs}</span>
                <span className="w-16 text-right tnum text-xs text-slate-500">{o.total}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
