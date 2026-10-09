import { memo, useEffect, useRef, useState } from 'react';
import { BallChip, Card, PlayerLink, TeamLogo } from './ui.jsx';
import { num } from '../lib/format.js';
import BonusPoint from './BonusPoint.jsx';

/**
 * The key event carried by a fresh envelope (never by a snapshot): WICKET > SIX > FOUR, plus
 * innings and match completion. Dot balls and singles deliberately animate nothing.
 */
function keyEventOf(env, live) {
  if (!env || env.type === 'MATCH_STATE_UPDATED') return null;
  const fx = env.effects || [];
  if (fx.includes('MATCH_COMPLETED')) return { kind: 'result', text: live?.result?.text || 'Match complete' };
  if (fx.includes('WICKET')) return { kind: 'wicket', text: 'WICKET' };
  if (fx.includes('SUPER_OVER')) return { kind: 'innings', text: 'Super Over' };
  if (fx.includes('INNINGS_COMPLETED')) return { kind: 'innings', text: 'Innings complete' };
  if (fx.includes('SIX')) return { kind: 'six', text: 'SIX' };
  if (fx.includes('FOUR')) return { kind: 'four', text: 'FOUR' };
  return null;
}

const BANNER = {
  four: 'bg-sky-500 text-white',
  six: 'bg-violet-600 text-white',
  wicket: 'bg-red-600 text-white',
  innings: 'bg-amber-400 text-slate-950',
  result: 'bg-emerald-500 text-white',
};

function useKeyEvent(envelope, live) {
  const [fx, setFx] = useState(null);
  const seen = useRef(envelope?.version ?? null);
  useEffect(() => {
    if (!envelope || envelope.version === seen.current) return undefined;
    seen.current = envelope.version;
    const ev = keyEventOf(envelope, live);
    if (!ev) return undefined;
    setFx({ ...ev, key: envelope.version });
    const t = setTimeout(() => setFx(null), ev.kind === 'result' ? 4000 : 1700);
    return () => clearTimeout(t);
  }, [envelope, live]);
  return fx;
}

export function LiveBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white ${className}`}>
      <span className="relative flex h-1.5 w-1.5">
        <span className="live-ping absolute inline-flex h-full w-full rounded-full bg-white" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
      Live · ball by ball
    </span>
  );
}

/** The score is the hero. Dark, high-contrast, team colour as the only decoration. */
export function LiveHero({ live, envelope, compact = false }) {
  const fx = useKeyEvent(envelope, live);
  const c = live.current;
  const teams = live.teams;
  const batting = teams[c.battingTeam];
  // The innings being chased: the first of the current pair (main match or Super Over).
  const first = c.target !== null ? live.innings[c.inningsNumber - 2] : null;
  const inPlay = live.state === 'IN_PROGRESS';
  const breakText = live.superOver && c.target !== null
    ? 'Scores level — a Super Over will decide the winner'
    : `${teams[c.bowlingTeam]?.name} need ${c.runs + 1} to win`;
  const fxClass = fx ? `fx-${fx.kind}` : '';
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-slate-950 text-white ring-1 ring-black/5 ${fxClass}`}>
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: batting?.color || 'var(--brand)' }} />
      <div className="p-4 pl-5 sm:p-5 sm:pl-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          {inPlay ? <LiveBadge /> : (
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/80">
              {live.state === 'INNINGS_BREAK' ? 'Innings break' : live.state === 'COMPLETED' ? 'Result' : 'Pre-match'}
            </span>
          )}
          {live.superOver && <span className="rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white">Super Over{live.superOver > 1 ? ` ${live.superOver}` : ''}</span>}
          {c.freeHit && inPlay && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-slate-950">Free hit</span>}
        </div>
        <div className="flex items-end gap-3">
          <TeamLogo team={batting} size={compact ? 'h-10 w-10 text-xs' : 'h-12 w-12 text-sm'} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white/70">{batting?.name}{c.target !== null && ' · chasing'}</p>
            <p className={`fx-score origin-left tnum font-black leading-none tracking-tight ${compact ? 'text-4xl' : 'text-5xl sm:text-6xl'}`}>
              <span data-testid="live-score">{c.runs}<span className="text-white/40">/</span>{c.wickets}</span>
              <span className="ml-2 align-middle text-base font-semibold text-white/60 sm:text-lg">{c.overs}<span className="text-white/35"> / {c.maxOvers} ov</span></span>
            </p>
          </div>
          <div className="shrink-0 space-y-0.5 text-right text-xs text-white/60">
            <p>CRR <span className="tnum text-sm font-bold text-white">{num(c.crr)}</span></p>
            {c.rrr !== null && <p>RRR <span className="tnum text-sm font-bold text-amber-300">{num(c.rrr)}</span></p>}
          </div>
        </div>

        <div className="mt-3 text-sm">
          {live.result ? <p className="font-semibold text-emerald-300">{live.result.text}</p>
            : c.target !== null && inPlay ? (
              <p className="text-white/85">Need <b className="tnum text-amber-300">{c.runsNeeded}</b> from <b className="tnum text-amber-300">{c.ballsRemaining}</b> balls <span className="text-white/50">· Target {c.target}</span></p>
            ) : live.state === 'INNINGS_BREAK' ? (
              <p className="font-medium text-amber-300">{breakText}</p>
            ) : c.partnership ? <p className="text-white/60">Partnership <b className="tnum text-white/90">{c.partnership.runs}</b> ({c.partnership.balls})</p> : null}
          {first && <p className="mt-0.5 text-xs text-white/50">{teams[first.battingTeam]?.shortName} {first.runs}/{first.wickets} ({first.overs})</p>}
        </div>

        {c.thisOver.balls.length > 0 && <ThisOver over={c.thisOver} />}
      </div>
      {fx && (
        <div key={fx.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
          <span className={`fx-banner rounded-xl px-6 py-2 text-3xl font-black uppercase italic tracking-tight shadow-lg sm:text-4xl ${BANNER[fx.kind]}`}>{fx.text}</span>
        </div>
      )}
    </div>
  );
}

function ThisOver({ over }) {
  return (
    <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
      <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-white/45">Over {over.over}</span>
      <div className="flex flex-1 flex-wrap gap-1.5">
        {over.balls.map((b, i) => (
          <span key={`${over.over}-${i}`} className={i === over.balls.length - 1 ? 'ball-new' : ''}>
            <BallChip label={b} size="h-7 min-w-7 text-[11px]" dark />
          </span>
        ))}
      </div>
      <span className="tnum text-xs font-semibold text-white/70">{over.runs}</span>
    </div>
  );
}

function Batter({ b, onStrike }) {
  if (!b) return <tr><td colSpan={6} className="py-1.5 text-slate-400">—</td></tr>;
  return (
    <tr className="border-t border-slate-100">
      <td className="py-2 pr-2">
        <PlayerLink id={b.id} className="font-semibold text-slate-900">{b.name}</PlayerLink>
        {onStrike && <span className="ml-1 text-brand" title="On strike">●</span>}
      </td>
      <td className="text-right text-base font-bold tnum">{b.runs}</td>
      <td className="text-right text-slate-500 tnum">{b.balls}</td>
      <td className="text-right text-slate-500 tnum">{b.fours}</td>
      <td className="text-right text-slate-500 tnum">{b.sixes}</td>
      <td className="text-right text-slate-500 tnum">{num(b.sr, 1)}</td>
    </tr>
  );
}

export const CreaseCard = memo(function CreaseCard({ c }) {
  return (
    <Card className="p-4">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr><th className="pb-1 text-left font-medium">Batter</th><th className="text-right font-medium">R</th><th className="text-right font-medium">B</th><th className="text-right font-medium">4s</th><th className="text-right font-medium">6s</th><th className="text-right font-medium">SR</th></tr>
        </thead>
        <tbody>
          <Batter b={c.striker} onStrike />
          <Batter b={c.nonStriker} />
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
        <span>
          <span className="mr-1 text-[11px] uppercase tracking-wide text-slate-500">Bowler</span>
          {c.bowler ? <PlayerLink id={c.bowler.id} className="font-semibold">{c.bowler.name}</PlayerLink> : <span className="text-slate-400">Between overs</span>}
        </span>
        {c.bowler && <span className="tnum font-medium text-slate-700">{c.bowler.overs}-{c.bowler.maidens}-{c.bowler.runs}-<b>{c.bowler.wickets}</b></span>}
      </div>
      {c.lastWicket && (
        <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
          Last wicket: <b className="text-slate-800">{c.lastWicket.name}</b> {c.lastWicket.runs} ({c.lastWicket.balls}) · {c.lastWicket.howOut} · {c.lastWicket.score}
        </p>
      )}
    </Card>
  );
});

function RecentOvers({ c }) {
  const overs = c.recentOvers.filter((o) => o.over !== c.thisOver.over).slice(-3).reverse();
  if (!overs.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent overs</p>
      <div className="space-y-2">
        {overs.map((o) => (
          <div key={o.over} className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs text-slate-500">Ov {o.over}</span>
            <div className="flex flex-1 flex-wrap gap-1">{o.balls.map((b, i) => <BallChip key={i} label={b} size="h-7 min-w-7 text-[11px]" />)}</div>
            <span className="tnum text-xs font-semibold text-slate-700">{o.runs}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Full live view of a match. Updates after every ball. */
export default function LivePanel({ live, envelope, children }) {
  if (!live) return null;
  const c = live.current;
  const teams = live.teams;
  if (!c) {
    return (
      <Card className="p-6 text-center text-sm text-slate-600">
        {live.match?.toss
          ? `${teams[live.match.toss.winner]?.name} won the toss and chose to ${live.match.toss.decision}. Play will start soon.`
          : 'The match has not started yet.'}
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <LiveHero live={live} envelope={envelope} />
      {live.state === 'IN_PROGRESS' && <CreaseCard c={c} />}
      <BonusPoint bonus={live.bonus} />
      <RecentOvers c={c} />
      {children}
    </div>
  );
}
