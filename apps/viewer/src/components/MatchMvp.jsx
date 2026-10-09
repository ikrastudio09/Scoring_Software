import { useEffect } from 'react';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Card, PlayerLink, Spinner, TeamDot } from './ui.jsx';

const MEDAL = ['🥇', '🥈', '🥉'];

function line(p) {
  const parts = [];
  if (p.batting && (p.batting.runs || p.batting.balls)) parts.push(`${p.batting.runs}${p.batting.out ? '' : '*'} (${p.batting.balls})`);
  if (p.bowling) parts.push(`${p.bowling.wickets}/${p.bowling.runs} (${p.bowling.overs})`);
  const f = p.fielding || {};
  const fl = (f.catches || 0) + (f.runOuts || 0) + (f.stumpings || 0);
  if (fl) parts.push(`${fl} fielding`);
  return parts.join(' · ');
}

/** Top 5 by impact score, with the statistics that put each player there. */
export default function MatchMvp({ matchId, version }) {
  const { data, reload } = useApi(api, `/matches/${matchId}/mvp`, [matchId]);
  useEffect(() => { if (version) reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Spinner />;
  if (!data.players.length) return <Card className="p-6 text-center text-sm text-slate-500">MVP rankings appear once play starts.</Card>;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{data.final ? 'Match MVP' : 'MVP race (live)'}</h3>
        <span className="text-[11px] text-slate-500">impact score</span>
      </div>
      <ol>
        {data.players.map((p) => (
          <li key={p.playerId} className="flex items-start gap-3 border-t border-slate-100 px-4 py-3 first:border-0">
            <span className="w-7 pt-0.5 text-center text-lg leading-none">{MEDAL[p.rank - 1] || <span className="text-sm font-semibold text-slate-400">#{p.rank}</span>}</span>
            <div className="min-w-0 flex-1">
              <PlayerLink id={p.playerId} className="flex items-center gap-2 font-semibold">
                <TeamDot color={p.teamInfo?.color} size="h-2.5 w-2.5" />{p.name}
                <span className="text-xs font-normal text-slate-500">{p.teamInfo?.shortName}</span>
              </PlayerLink>
              <p className="tnum text-xs text-slate-600">{line(p)}</p>
              {p.impact.reasons.length > 0 && <p className="mt-0.5 text-[11px] text-slate-500">{p.impact.reasons.join(' · ')}</p>}
            </div>
            <div className="text-right">
              <p className="tnum text-lg font-black leading-none text-slate-900">{Math.round(p.impact.total)}</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">impact</p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
