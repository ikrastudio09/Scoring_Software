import { useEffect, useState } from 'react';
import { fixed } from '@cricket/shared';
import { useApi, useCommentary } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Button, Card, ErrorBox, Spinner, useToast } from './ui.jsx';

export function AdminScorecard({ matchId, version }) {
  const { data, error, reload } = useApi(api, `/matches/${matchId}/scorecard`, [matchId]);
  useEffect(() => { reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const sc = data.scorecard;
  if (!sc.innings.length) return <p className="py-8 text-center text-sm text-slate-500">No innings yet.</p>;
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {sc.bonus?.conditions?.length > 0 && (
        <Card className="p-3 text-sm xl:col-span-2">
          <b>Bonus point (+{sc.bonus.points})</b>
          {sc.bonus.conditions.map((x) => <p key={x.kind} className={x.status === 'achieved' ? 'text-emerald-700' : 'text-slate-600'}>{x.status === 'achieved' ? '✓' : '•'} {x.text}</p>)}
        </Card>
      )}
      {sc.innings.map((inn) => (
        <Card key={inn.number} className="overflow-hidden text-sm">
          <div className="flex justify-between bg-slate-900 px-3 py-2 text-white">
            <b>{inn.battingTeamName}{inn.superOver ? ` · Super Over${inn.superOver > 1 ? ` ${inn.superOver}` : ''}` : ''}</b><b className="tnum">{inn.runs}/{inn.wickets} ({inn.overs})</b>
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

/** Generated commentary with in-place editing. The edit replaces the sentence only — never the score. */
export function CommentaryPanel({ matchId, limit = 60, compact = false }) {
  const { entries } = useCommentary({ api, live, matchId, channel: 'admin', limit });
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!entries) return compact ? null : <Spinner />;
  const list = compact ? entries.slice(0, 1) : entries;
  if (!list.length) return compact ? null : <p className="py-8 text-center text-sm text-slate-500">Commentary starts with the first ball.</p>;

  const save = async (seq, value) => {
    setBusy(true);
    try {
      await api.put(`/matches/${matchId}/commentary/${seq}`, { text: value });
      setEditing(null);
      toast(value ? 'Commentary updated' : 'Commentary reset', 'success', 1500);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Card className={compact ? 'px-3 py-2' : 'divide-y divide-slate-100'}>
      {list.map((e) => (
        <div key={e.seq} className={compact ? '' : 'px-4 py-3'}>
          <div className="flex items-start gap-3 text-sm">
            <span className="tnum w-10 shrink-0 pt-0.5 text-xs font-semibold text-slate-500">{e.over}</span>
            <div className="min-w-0 flex-1">
              {editing === e.seq ? (
                <div className="space-y-2">
                  <textarea autoFocus maxLength={500} rows={2} value={text} onChange={(ev) => setText(ev.target.value)}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save(e.seq, text.trim()); } if (ev.key === 'Escape') setEditing(null); }}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-teal-600" />
                  <div className="flex gap-2">
                    <Button size="px-3 py-1 text-xs" disabled={busy || !text.trim()} onClick={() => save(e.seq, text.trim())}>Save</Button>
                    {e.edited && <Button variant="secondary" size="px-3 py-1 text-xs" disabled={busy} onClick={() => save(e.seq, '')}>Use generated</Button>}
                    <Button variant="ghost" size="px-3 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className={compact ? 'truncate' : ''}>
                  {compact && <span className="mr-1 text-xs font-semibold uppercase text-slate-400">Last ball</span>}
                  {e.text}
                  {e.edited && <span className="ml-1 rounded bg-teal-50 px-1 text-[10px] font-semibold text-teal-700">edited</span>}
                </p>
              )}
              {!compact && editing !== e.seq && <p className="text-xs text-slate-500">{e.scoreText}</p>}
            </div>
            {editing !== e.seq && (
              <button type="button" className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-teal-700 hover:bg-teal-50" onClick={() => { setEditing(e.seq); setText(e.text); }}>Edit</button>
            )}
          </div>
        </div>
      ))}
    </Card>
  );
}
