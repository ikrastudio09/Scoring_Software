import { useEffect } from 'react';
import { fixed } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Card, ErrorBox, Spinner } from './ui.jsx';

export function AdminScorecard({ matchId, version }) {
  const { data, error, reload } = useApi(api, `/matches/${matchId}/scorecard`, [matchId]);
  useEffect(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const sc = data.scorecard;
  if (!sc.innings.length) return <p className="py-8 text-center text-sm text-slate-500">No innings yet.</p>;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {sc.innings.map((inn) => (
        <Card key={inn.number} className="overflow-hidden text-sm">
          <div className="flex justify-between bg-slate-900 px-3 py-2 text-white">
            <b>{inn.battingTeamName}</b><b className="tnum">{inn.runs}/{inn.wickets} ({inn.overs})</b>
          </div>
          <table className="w-full">
            <tbody>
              {inn.batting.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="px-3 py-1.5"><b>{b.name}</b><span className="ml-2 text-xs text-slate-500">{b.dismissal}</span></td>
                  <td className="tnum text-right font-semibold">{b.runs}</td>
                  <td className="tnum px-3 text-right text-slate-500">{b.balls}b {b.fours}×4 {b.sixes}×6</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1.5 text-xs text-slate-600">Extras {inn.extras.total} (wd {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes})</p>
          <table className="w-full border-t border-slate-200">
            <tbody>
              {inn.bowling.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium">{b.name}</td>
                  <td className="tnum px-3 text-right">{b.overs}-{b.maidens}-{b.runs}-<b>{b.wickets}</b></td>
                  <td className="tnum px-3 text-right text-xs text-slate-500">econ {fixed(b.econ)} · {b.wides}wd {b.noBalls}nb</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inn.fallOfWickets.length > 0 && <p className="px-3 py-2 text-xs text-slate-600">FOW: {inn.fallOfWickets.map((f) => `${f.runs}-${f.wicket} (${f.name}, ${f.overs})`).join(', ')}</p>}
        </Card>
      ))}
    </div>
  );
}

export function EventLog({ matchId, version }) {
  const { data, error, reload } = useApi(api, `/matches/${matchId}/events`, [matchId]);
  useEffect(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const events = [...data.events].reverse();
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th className="px-3 py-2 text-left">#</th><th className="text-left">Time</th><th className="text-left">Event</th><th className="text-left">Situation before</th><th className="px-3 text-left">By</th></tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.seq} className={`border-t border-slate-100 ${e.undone ? 'text-slate-400 line-through' : ''}`}>
              <td className="tnum px-3 py-1.5">{e.seq}</td>
              <td className="tnum text-xs">{new Date(e.createdAt).toLocaleTimeString()}</td>
              <td>
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${e.type === 'UNDO' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}>{e.type}</span>
                {e.label}
                {e.undone && <span className="ml-2 text-xs no-underline">(undone by #{e.undoneBySeq})</span>}
              </td>
              <td className="tnum text-xs">{e.context?.innings ? `Inns ${e.context.innings} · ${e.context.score} (${e.context.over})` : '—'}</td>
              <td className="px-3 text-xs">{e.user?.username}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!events.length && <p className="p-6 text-center text-sm text-slate-500">No events yet.</p>}
    </Card>
  );
}
