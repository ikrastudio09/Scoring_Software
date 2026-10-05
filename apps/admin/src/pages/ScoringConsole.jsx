import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DISMISSAL_LABELS, fixed } from '@cricket/shared';
import { useApi, useLiveMatch } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { useScoring } from '../lib/useScoring.js';
import { useAuth } from '../lib/auth.jsx';
import { Ball, Button, Card, ConnectionPill, ErrorBox, Field, Modal, Select, Spinner, StatusBadge, useToast } from '../components/ui.jsx';
import { AdminScorecard, EventLog } from '../components/MatchPanels.jsx';

const pickView = (d) => d.view;
const EXTRA_LABEL = { wide: 'Wide', noball: 'No-ball', bye: 'Bye', legbye: 'Leg bye' };
const EVENT_LABEL = { START_INNINGS: 'start of innings', SET_BOWLER: 'bowler selection', NEW_BATTER: 'new batter', RETIRE: 'retirement', SWAP_STRIKE: 'strike swap', END_INNINGS: 'end of innings', CONCLUDE: 'match conclusion' };

export default function ScoringConsole() {
  const { id } = useParams();
  const toast = useToast();
  const { live: view, error, refresh, apply } = useLiveMatch({ api, live, matchId: id, channel: 'admin', path: 'scorer', pick: pickView });
  const scoring = useScoring({ matchId: id, version: view?.version, apply, toast });
  const [tab, setTab] = useState('score');

  if (error && !view) return <ErrorBox error={error} onRetry={refresh} />;
  if (!view) return <Spinner />;
  return <Console view={view} scoring={scoring} tab={tab} setTab={setTab} matchId={id} refresh={refresh} />;
}

function Console({ view, scoring, tab, setTab, matchId, refresh }) {
  const toast = useToast();
  const c = view.current;
  const teams = view.teams;
  const status = view.match.status;
  const [extra, setExtra] = useState(null);
  const [nbType, setNbType] = useState('bat');
  const [modal, setModal] = useState(null);
  const inPlay = view.state === 'IN_PROGRESS';
  const canBowl = inPlay && !view.needs?.batter && !view.needs?.bowler;
  const { send, locked } = scoring;

  const deliver = useCallback((runs, { boundary } = {}) => {
    if (!canBowl) return;
    if (locked) {
      // Never drop input silently: a second tap while saving is almost always a double tap.
      toast('Still saving the previous ball — that input was ignored', 'error', 2000);
      return;
    }
    if ((extra === 'bye' || extra === 'legbye') && runs === 0) return;
    const body = { runs };
    if (extra) body.extra = extra;
    if (extra === 'noball') body.noBallRunsType = nbType;
    const isBoundary = boundary ?? (runs === 4 || runs === 6);
    if (isBoundary && (runs === 4 || (runs === 6 && (!extra || (extra === 'noball' && nbType === 'bat'))))) body.boundary = true;
    send('deliveries', body, extra ? `${EXTRA_LABEL[extra]} ${runs}` : String(runs));
    setExtra(null);
    setNbType('bat');
  }, [canBowl, locked, extra, nbType, send, toast]);

  // Keyboard shortcuts for laptop scorers.
  useEffect(() => {
    const onKey = (e) => {
      if (modal || tab !== 'score' || e.target.closest('input, select, textarea') || e.metaKey || e.altKey) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); if (view.undo) setModal('undo'); return; }
      if (e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (/^[0-7]$/.test(k)) { e.preventDefault(); deliver(Number(k)); return; }
      const map = { w: 'wide', n: 'noball', b: 'bye', l: 'legbye' };
      if (map[k] && canBowl) { setExtra((x) => (x === map[k] ? null : map[k])); return; }
      if (k === 'escape') setExtra(null);
      if (k === 'x' && canBowl && !locked) setModal('wicket');
      if (k === 'u' && view.undo && !locked) setModal('undo');
      if (k === 's' && inPlay && !locked) send('swap-strike', {}, 'Swap strike');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, tab, deliver, canBowl, locked, view.undo, inPlay, send]);

  if (!view.scorer) {
    return (
      <Card className="p-6 text-center">
        <p className="font-semibold">This match has not been set up.</p>
        <p className="mt-1 text-sm text-slate-500">Record the toss and playing XIs first.</p>
        <Link to={`/matches/${matchId}/setup`}><Button className="mt-4">Set up match</Button></Link>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-900">← Matches</Link>
        <h1 className="text-lg font-bold">Match {view.match.number}: {teams[view.match.teamA]?.shortName} v {teams[view.match.teamB]?.shortName}</h1>
        <StatusBadge status={status} />
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">v{view.version} <ConnectionPill /></span>
      </div>

      <UnsentBanner scoring={scoring} />

      <div className="mb-3 flex gap-1 rounded-lg bg-slate-200/70 p-1 text-sm">
        {[['score', 'Score'], ['scorecard', 'Scorecard'], ['log', 'Event log']].map(([v, l]) => (
          <button key={v} type="button" onClick={() => setTab(v)} className={`flex-1 rounded-md px-3 py-1.5 font-medium ${tab === v ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {tab === 'scorecard' && <AdminScorecard matchId={matchId} version={view.version} />}
      {tab === 'log' && <EventLog matchId={matchId} version={view.version} />}
      {tab === 'score' && (
        <div className="grid gap-3 lg:grid-cols-[1fr_420px]">
          <div className="space-y-3">
            <Scoreboard view={view} />
            {c && <CreasePanel view={view} onSwap={() => !locked && send('swap-strike', {}, 'Swap strike')} locked={locked} />}
          </div>
          <div className="space-y-3">
            {view.state === 'COMPLETED' ? <ResultPanel view={view} matchId={matchId} onUndo={() => setModal('undo')} locked={locked} refresh={refresh} />
              : view.state === 'NOT_STARTED' || view.needs?.startInnings ? <StartInnings view={view} send={send} locked={locked} />
                : view.needs?.batter ? <BatterPicker view={view} send={send} locked={locked} />
                  : view.needs?.bowler ? <BowlerPicker view={view} send={send} locked={locked} />
                    : (
                      <Pad
                        view={view} extra={extra} setExtra={setExtra} nbType={nbType} setNbType={setNbType}
                        deliver={deliver} locked={locked} pending={scoring.pending}
                        onWicket={() => setModal('wicket')} onUndo={() => setModal('undo')} onMore={() => setModal('more')}
                      />
                    )}
            {view.state !== 'COMPLETED' && (view.needs?.batter || view.needs?.bowler || view.needs?.startInnings) && view.undo && (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" disabled={locked} onClick={() => setModal('undo')}>↶ Undo last</Button>
                {inPlay && <Button variant="secondary" className="flex-1" disabled={locked} onClick={() => setModal('more')}>More…</Button>}
              </div>
            )}
          </div>
        </div>
      )}

      <WicketModal open={modal === 'wicket'} onClose={() => setModal(null)} view={view} send={send} />
      <UndoModal open={modal === 'undo'} onClose={() => setModal(null)} view={view} send={send} />
      <MoreModal open={modal === 'more'} onClose={() => setModal(null)} view={view} send={send} />
    </div>
  );
}

function UnsentBanner({ scoring }) {
  const { unsent, pending, retryNow } = scoring;
  if (!unsent) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-300" role="alert">
      <span className="h-3 w-3 animate-pulse rounded-full bg-amber-500" />
      <span className="flex-1"><b>Not yet confirmed:</b> “{unsent.label}”. Retrying automatically — it will be recorded exactly once. Scoring is paused until the server confirms.</span>
      <Button variant="secondary" size="px-3 py-1.5 text-xs" disabled={Boolean(pending)} onClick={retryNow}>Retry now</Button>
    </div>
  );
}

function Scoreboard({ view }) {
  const c = view.current;
  const teams = view.teams;
  if (!c) {
    return (
      <Card className="p-5">
        <p className="text-sm text-slate-500">Toss: {view.match.toss ? `${teams[view.match.toss.winner]?.name} chose to ${view.match.toss.decision}` : '—'}</p>
        <p className="mt-1 text-2xl font-bold">{teams[view.scorer.battingTeam]?.name} to bat</p>
        <p className="text-sm text-slate-500">{view.rules.oversPerInnings} overs · max {view.rules.maxOversPerBowler} per bowler</p>
      </Card>
    );
  }
  const first = view.innings[0];
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 p-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{teams[c.battingTeam]?.name} · Innings {c.inningsNumber}</p>
          <p data-testid="score" className="tnum text-5xl font-black tracking-tight">{c.runs}/{c.wickets}</p>
        </div>
        <div className="pb-1">
          <p data-testid="overs" className="tnum text-2xl font-bold">{c.overs}<span className="text-base font-medium text-slate-400"> / {c.maxOvers}</span></p>
          <p className="text-xs text-slate-500">overs</p>
        </div>
        <div className="ml-auto grid grid-cols-2 gap-x-5 gap-y-0.5 pb-1 text-sm">
          <span className="text-slate-500">CRR</span><span className="tnum font-semibold">{fixed(c.crr)}</span>
          <span className="text-slate-500">Extras</span><span className="tnum font-semibold">{c.extras}</span>
          {c.partnership && <><span className="text-slate-500">P'ship</span><span className="tnum font-semibold">{c.partnership.runs} ({c.partnership.balls})</span></>}
        </div>
      </div>
      {c.target !== null && (
        <div className="flex flex-wrap gap-x-5 border-t border-slate-100 bg-slate-50 px-4 py-2 text-sm">
          <span>Target <b className="tnum">{c.target}</b></span>
          <span>Need <b className="tnum">{c.runsNeeded}</b> off <b className="tnum">{c.ballsRemaining}</b></span>
          <span>RRR <b className="tnum">{fixed(c.rrr)}</b></span>
          <span className="text-slate-500">{teams[first.battingTeam]?.shortName} {first.runs}/{first.wickets} ({first.overs})</span>
        </div>
      )}
      {c.freeHit && view.state === 'IN_PROGRESS' && <div className="bg-amber-500 py-1 text-center text-xs font-black uppercase tracking-widest text-white">Free hit</div>}
      {view.state === 'INNINGS_BREAK' && <div className="bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">Innings complete — target {c.runs + 1}</div>}
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs font-medium text-slate-500">Over {c.thisOver.over}</span>
          <div className="flex flex-wrap gap-1.5">{c.thisOver.balls.length ? c.thisOver.balls.map((b, i) => <Ball key={i} label={b} />) : <span className="text-sm text-slate-400">—</span>}</div>
          <span className="ml-auto tnum text-sm font-semibold">{c.thisOver.runs} runs</span>
        </div>
        {c.recentOvers.filter((o) => o.over !== c.thisOver.over).slice(-2).reverse().map((o) => (
          <div key={o.over} className="mt-1.5 flex items-center gap-2 opacity-70">
            <span className="w-16 text-xs text-slate-500">Over {o.over}</span>
            <div className="flex flex-wrap gap-1">{o.balls.map((b, i) => <Ball key={i} label={b} />)}</div>
            <span className="ml-auto tnum text-sm">{o.runs}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CreasePanel({ view, onSwap, locked }) {
  const c = view.current;
  const row = (b, striker) => (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2 ${striker ? 'bg-teal-50 ring-1 ring-teal-200' : ''}`}>
      <span className={`w-4 text-center font-black ${striker ? 'text-teal-700' : 'text-transparent'}`}>●</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{b ? b.name : <span className="font-normal italic text-slate-400">new batter needed</span>}</span>
      {b && <span className="tnum text-sm"><b className="text-lg">{b.runs}</b> <span className="text-slate-500">({b.balls})</span> <span className="text-xs text-slate-400">{b.fours}×4 {b.sixes}×6</span></span>}
    </div>
  );
  return (
    <Card className="p-3">
      {row(c.striker, true)}
      {row(c.nonStriker, false)}
      <div className="mt-2 flex items-center gap-3 border-t border-slate-100 px-3 pt-2">
        <span className="text-xs font-medium text-slate-500">Bowler</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{c.bowler?.name || <span className="font-normal italic text-slate-400">select bowler</span>}</span>
        {c.bowler && <span className="tnum text-sm">{c.bowler.overs}-{c.bowler.maidens}-{c.bowler.runs}-<b>{c.bowler.wickets}</b></span>}
        {view.state === 'IN_PROGRESS' && <Button variant="ghost" size="px-2 py-1 text-xs" disabled={locked} onClick={onSwap} title="Swap strike (S)">⇄ Swap</Button>}
      </div>
      {c.lastWicket && <p className="mt-2 px-3 text-xs text-slate-500">Last wicket: {c.lastWicket.name} {c.lastWicket.runs} ({c.lastWicket.balls}) — {c.lastWicket.howOut} · {c.lastWicket.score}</p>}
    </Card>
  );
}

function Pad({ view, extra, setExtra, nbType, setNbType, deliver, locked, pending, onWicket, onUndo, onMore }) {
  const runBtn = 'h-16 rounded-xl text-2xl font-black shadow-sm ring-1 transition active:scale-95 disabled:opacity-40';
  const armed = (x) => extra === x;
  return (
    <Card className="pad p-3">
      <div className="mb-2 flex h-6 items-center justify-between text-xs">
        <span className="font-medium text-slate-500">{extra ? <span className="rounded bg-amber-500 px-2 py-0.5 font-bold text-white">{EXTRA_LABEL[extra].toUpperCase()} — tap runs</span> : 'Tap runs to record the ball'}</span>
        {pending && <span className="flex items-center gap-1.5 text-teal-700"><span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-200 border-t-teal-700" /> saving…</span>}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((r) => (
          <button key={r} type="button" disabled={locked || ((extra === 'bye' || extra === 'legbye') && r === 0)} onClick={() => deliver(r)} className={`${runBtn} bg-white ring-slate-300 hover:bg-slate-50`}>{r === 0 && !extra ? '•' : r}</button>
        ))}
        <button type="button" disabled={locked} onClick={() => deliver(4)} className={`${runBtn} bg-sky-600 text-white ring-sky-700 hover:bg-sky-700`}>4</button>
        <button type="button" disabled={locked || extra === 'wide' || extra === 'bye' || extra === 'legbye' || (extra === 'noball' && nbType !== 'bat')} onClick={() => deliver(6)} className={`${runBtn} bg-violet-600 text-white ring-violet-700 hover:bg-violet-700`}>6</button>
        <button type="button" disabled={locked} onClick={() => deliver(5)} className={`${runBtn} bg-white text-xl ring-slate-300`}>5</button>
        <button type="button" disabled={locked} onClick={() => deliver(4, { boundary: false })} className={`${runBtn} bg-white text-sm ring-slate-300`} title="Four runs completed (not a boundary)">4 run</button>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        {Object.entries({ wide: 'Wd', noball: 'Nb', bye: 'B', legbye: 'LB' }).map(([k, l]) => (
          <button key={k} type="button" disabled={locked} onClick={() => setExtra(armed(k) ? null : k)}
            className={`h-12 rounded-xl text-base font-bold ring-1 transition active:scale-95 ${armed(k) ? 'bg-amber-500 text-white ring-amber-600' : 'bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-100'}`}>{l}</button>
        ))}
      </div>
      {extra === 'noball' && (
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-amber-50 p-1 text-xs">
          <span className="px-2 font-medium text-amber-900">Runs off:</span>
          {[['bat', 'Bat'], ['bye', 'Byes'], ['legbye', 'Leg byes']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setNbType(k)} className={`flex-1 rounded-md py-1.5 font-semibold ${nbType === k ? 'bg-amber-500 text-white' : 'text-amber-900'}`}>{l}</button>
          ))}
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2">
        <button type="button" disabled={locked} onClick={onWicket} className="h-14 rounded-xl bg-red-600 text-lg font-black text-white shadow-sm transition hover:bg-red-700 active:scale-95 disabled:opacity-40">WICKET</button>
        <button type="button" disabled={locked || !view.undo} onClick={onUndo} className="h-14 rounded-xl bg-slate-800 font-bold text-white transition hover:bg-slate-900 active:scale-95 disabled:opacity-40">↶ Undo</button>
        <button type="button" disabled={locked} onClick={onMore} className="h-14 rounded-xl bg-white font-bold ring-1 ring-slate-300 transition hover:bg-slate-50 active:scale-95">More…</button>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">Keys: 0–7 runs · W wide · N no-ball · B bye · L leg bye · X wicket · S swap · U undo · Esc clear</p>
    </Card>
  );
}

function PickerGrid({ items, onPick, locked, render }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((p) => (
        <button key={p.id} type="button" disabled={locked || p.available === false} onClick={() => onPick(p)}
          className="rounded-xl bg-white p-3 text-left ring-1 ring-slate-300 transition hover:bg-teal-50 hover:ring-teal-400 active:scale-[.98] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60">
          {render(p)}
        </button>
      ))}
    </div>
  );
}

function BatterPicker({ view, send, locked }) {
  const c = view.current;
  const end = !c.striker ? 'striker' : 'non-striker';
  return (
    <Card className="p-4">
      <h2 className="font-semibold">New batter</h2>
      <p className="mb-3 text-sm text-slate-500">Comes in at the {end}’s end{c.lastWicket ? ` after ${c.lastWicket.name}’s dismissal` : ''}.</p>
      <PickerGrid items={view.scorer.yetToBat} locked={locked} onPick={(p) => send('batter', { batterId: p.id }, `New batter ${p.name}`)}
        render={(p) => <><p className="font-semibold">{p.name}</p>{p.returning && <p className="text-xs text-amber-700">returning (retired hurt)</p>}</>} />
      {!view.scorer.yetToBat.length && <p className="text-sm text-slate-500">No batters left. Use More… → End innings.</p>}
    </Card>
  );
}

function BowlerPicker({ view, send, locked, midOver = false, onDone }) {
  return (
    <Card className="p-4">
      <h2 className="font-semibold">{midOver ? 'Replacement bowler' : `Bowler for over ${view.current.thisOver.completed ? view.current.thisOver.over + 1 : view.current.thisOver.over}`}</h2>
      <p className="mb-3 text-sm text-slate-500">Max {view.rules.maxOversPerBowler} overs each; no consecutive overs.</p>
      <PickerGrid
        items={view.scorer.bowlers} locked={locked}
        onPick={async (p) => { await send('bowler', { bowlerId: p.id, ...(midOver ? { midOver: true } : {}) }, `Bowler ${p.name}`); onDone?.(); }}
        render={(p) => (
          <>
            <p className="font-semibold">{p.name}</p>
            <p className="tnum text-xs text-slate-500">{p.overs} ov · {p.runs} r · {p.wickets} w</p>
            {!p.available && <p className="text-xs font-medium text-red-600">{p.reason}</p>}
          </>
        )}
      />
    </Card>
  );
}

function StartInnings({ view, send, locked }) {
  const s = view.scorer;
  const [form, setForm] = useState({ strikerId: s.battingXI[0]?.id, nonStrikerId: s.battingXI[1]?.id, bowlerId: '' });
  useEffect(() => { setForm({ strikerId: s.battingXI[0]?.id, nonStrikerId: s.battingXI[1]?.id, bowlerId: '' }); }, [s.battingTeam]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = view.innings.length + 1;
  const valid = form.strikerId && form.nonStrikerId && form.bowlerId && form.strikerId !== form.nonStrikerId;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">Start innings {n}: {view.teams[s.battingTeam]?.name} batting</h2>
      {n === 2 && <p className="rounded-lg bg-slate-50 p-2 text-sm">Target: <b>{view.innings[0].runs + 1}</b> from {view.rules.oversPerInnings} overs</p>}
      <Field label="Striker"><Select value={form.strikerId} onChange={(e) => setForm({ ...form, strikerId: e.target.value })}>{s.battingXI.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Non-striker"><Select value={form.nonStrikerId} onChange={(e) => setForm({ ...form, nonStrikerId: e.target.value })}>{s.battingXI.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Opening bowler"><Select value={form.bowlerId} onChange={(e) => setForm({ ...form, bowlerId: e.target.value })}><option value="">Select…</option>{s.bowlingXI.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      {form.strikerId === form.nonStrikerId && <p className="text-sm text-red-600">Choose two different openers.</p>}
      <Button className="w-full" size="py-3 text-base" disabled={!valid || locked} onClick={() => send('innings/start', form, `Start innings ${n}`)}>Start innings</Button>
    </Card>
  );
}

const WICKET_TYPES = ['bowled', 'caught', 'caught_and_bowled', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'obstructing_field', 'hit_ball_twice'];
const POSSIBLE = { wide: ['stumped', 'run_out', 'hit_wicket', 'obstructing_field'], noball: ['run_out', 'obstructing_field', 'hit_ball_twice'] };

function WicketModal({ open, onClose, view, send }) {
  const c = view.current;
  const [type, setType] = useState(null);
  const [f, setF] = useState({});
  useEffect(() => { if (open) { setType(null); setF({ who: 'striker', runs: 0, extra: '', fielderId: '' }); } }, [open]);
  if (!open || !c) return null;
  const freeHit = c.freeHit;
  const allowedOn = (t, extra) => {
    if (extra && !POSSIBLE[extra].includes(t)) return false;
    if (freeHit && !extra && !['run_out', 'obstructing_field', 'hit_ball_twice'].includes(t)) return false;
    return true;
  };
  const needsWho = type === 'run_out' || type === 'obstructing_field';
  const fielderOpt = ['caught', 'run_out', 'stumped'].includes(type);
  const runsAllowed = needsWho;
  const extras = type === 'stumped' || type === 'hit_wicket' ? ['', 'wide'] : needsWho ? ['', 'wide', 'noball'] : type === 'hit_ball_twice' ? ['', 'noball'] : [''];
  const valid = type && allowedOn(type, f.extra || null) && (type !== 'caught' || f.fielderId);

  const submit = () => {
    const wicket = { type };
    if (needsWho) wicket.batterId = f.who === 'striker' ? c.striker.id : c.nonStriker.id;
    if (fielderOpt && f.fielderId && f.fielderId !== 'sub') wicket.fielderId = f.fielderId;
    if (fielderOpt && f.fielderId === 'sub') wicket.substituteFielder = true;
    const body = { runs: runsAllowed ? Number(f.runs) : 0, wicket };
    if (f.extra) body.extra = f.extra;
    const who = needsWho ? (f.who === 'striker' ? c.striker.name : c.nonStriker.name) : c.striker.name;
    send('deliveries', body, `Wicket: ${who} ${DISMISSAL_LABELS[type].toLowerCase()}`);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`Wicket${freeHit ? ' (free hit)' : ''}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={!valid} onClick={submit}>Record wicket</Button></>}>
      <div className="grid grid-cols-3 gap-2">
        {WICKET_TYPES.map((t) => {
          const possible = allowedOn(t, null) || ['wide', 'noball'].some((x) => POSSIBLE[x].includes(t) && allowedOn(t, x));
          return (
            <button key={t} type="button" disabled={!possible} onClick={() => { setType(t); setF((x) => ({ ...x, extra: '' })); }}
              className={`rounded-lg px-2 py-3 text-sm font-semibold ring-1 transition disabled:opacity-30 ${type === t ? 'bg-red-600 text-white ring-red-700' : 'bg-white ring-slate-300 hover:bg-red-50'}`}>
              {DISMISSAL_LABELS[t]}
            </button>
          );
        })}
      </div>
      {type && (
        <div className="mt-4 space-y-3">
          {needsWho && (
            <Field label="Batter out">
              <div className="grid grid-cols-2 gap-2">
                {[['striker', c.striker], ['nonStriker', c.nonStriker]].map(([k, b]) => (
                  <button key={k} type="button" onClick={() => setF({ ...f, who: k })} className={`rounded-lg px-3 py-2 text-sm font-semibold ring-1 ${f.who === k ? 'bg-slate-900 text-white' : 'bg-white ring-slate-300'}`}>
                    {b.name} <span className="text-xs font-normal opacity-70">({k === 'striker' ? 'striker' : 'non-striker'})</span>
                  </button>
                ))}
              </div>
            </Field>
          )}
          {fielderOpt && (
            <Field label={type === 'caught' ? 'Caught by (required)' : type === 'stumped' ? 'Wicket-keeper' : 'Fielder (optional)'}>
              <Select value={f.fielderId} onChange={(e) => setF({ ...f, fielderId: e.target.value })}>
                <option value="">{type === 'caught' ? 'Select fielder…' : 'Not recorded'}</option>
                {view.scorer.bowlingXI.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value="sub">Substitute fielder</option>
              </Select>
            </Field>
          )}
          {runsAllowed && (
            <Field label="Runs completed before the dismissal">
              <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((r) => <button key={r} type="button" onClick={() => setF({ ...f, runs: r })} className={`rounded-lg py-2 font-bold ring-1 ${Number(f.runs) === r ? 'bg-slate-900 text-white' : 'bg-white ring-slate-300'}`}>{r}</button>)}</div>
            </Field>
          )}
          {extras.length > 1 && (
            <Field label="Delivery">
              <div className="grid grid-cols-3 gap-2">
                {extras.map((x) => (
                  <button key={x || 'legal'} type="button" disabled={!allowedOn(type, x || null)} onClick={() => setF({ ...f, extra: x })}
                    className={`rounded-lg py-2 text-sm font-semibold ring-1 disabled:opacity-30 ${f.extra === x ? 'bg-slate-900 text-white' : 'bg-white ring-slate-300'}`}>{x ? EXTRA_LABEL[x] : 'Legal ball'}</button>
                ))}
              </div>
            </Field>
          )}
          {!allowedOn(type, f.extra || null) && <p className="text-sm text-red-600">{DISMISSAL_LABELS[type]} is not possible on this delivery{freeHit ? ' (free hit)' : ''}.</p>}
        </div>
      )}
    </Modal>
  );
}

function UndoModal({ open, onClose, view, send }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); send('undo', {}, 'Undo'); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, send, onClose]);
  const u = view.undo;
  if (!u) return null;
  const what = u.type === 'DELIVERY' ? `the delivery “${u.label}”` : EVENT_LABEL[u.type] || u.type;
  return (
    <Modal open={open} onClose={onClose} title="Undo last action" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="dark" onClick={() => { send('undo', {}, 'Undo'); onClose(); }}>Undo (Enter)</Button></>}>
      <p>This will revert <b>{what}</b> and restore the score, strike, bowler and statistics to how they were before it.</p>
      <p className="mt-2 text-sm text-slate-500">The original entry stays in the event log, marked as undone.</p>
    </Modal>
  );
}

function MoreModal({ open, onClose, view, send }) {
  const [panel, setPanel] = useState(null);
  const [reason, setReason] = useState('');
  const [retire, setRetire] = useState({ who: 'striker', kind: 'retired_hurt' });
  const [conclude, setConclude] = useState({ resultType: 'no_result', winnerTeamId: '' });
  useEffect(() => { if (open) setPanel(null); }, [open]);
  const c = view.current;
  if (!open) return null;
  const teamIds = [view.match.teamA, view.match.teamB];
  return (
    <Modal open={open} onClose={onClose} title="More actions" wide={panel === 'bowler'}>
      {!panel && (
        <div className="grid gap-2">
          <Button variant="secondary" disabled={!c?.bowler} onClick={() => setPanel('bowler')}>Change bowler mid-over (injury)</Button>
          <Button variant="secondary" disabled={!c?.striker && !c?.nonStriker} onClick={() => setPanel('retire')}>Retire a batter</Button>
          <Button variant="secondary" onClick={() => { send('swap-strike', {}, 'Swap strike'); onClose(); }}>Swap strike (correction)</Button>
          <Button variant="secondary" onClick={() => setPanel('end')}>End innings now</Button>
          <Button variant="danger" onClick={() => setPanel('conclude')}>Conclude match (no result / abandoned / walkover)</Button>
        </div>
      )}
      {panel === 'bowler' && <BowlerPicker view={view} send={send} locked={false} midOver onDone={onClose} />}
      {panel === 'retire' && (
        <div className="space-y-3">
          <Field label="Batter">
            <Select value={retire.who} onChange={(e) => setRetire({ ...retire, who: e.target.value })}>
              {c.striker && <option value="striker">{c.striker.name} (striker)</option>}
              {c.nonStriker && <option value="nonStriker">{c.nonStriker.name} (non-striker)</option>}
            </Select>
          </Field>
          <Field label="Type" hint="Retired hurt is not a wicket and the batter may return later. Retired out counts as a wicket.">
            <Select value={retire.kind} onChange={(e) => setRetire({ ...retire, kind: e.target.value })}><option value="retired_hurt">Retired hurt</option><option value="retired_out">Retired out</option></Select>
          </Field>
          <Button className="w-full" onClick={() => { const b = retire.who === 'striker' ? c.striker : c.nonStriker; send('retire', { batterId: b.id, kind: retire.kind }, `${b.name} ${retire.kind.replace('_', ' ')}`); onClose(); }}>Confirm retirement</Button>
        </div>
      )}
      {panel === 'end' && (
        <div className="space-y-3">
          <p className="text-sm">Innings normally end automatically (overs, all out, target). Use this only for an exceptional stop.</p>
          <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Declared / other</option><option value="no_batters">No batters available</option><option value="time">Out of time</option></Select></Field>
          <Button variant="danger" className="w-full" onClick={() => { send('innings/end', reason ? { reason } : {}, 'End innings'); onClose(); }}>End innings</Button>
        </div>
      )}
      {panel === 'conclude' && (
        <div className="space-y-3">
          <Field label="Result">
            <Select value={conclude.resultType} onChange={(e) => setConclude({ ...conclude, resultType: e.target.value })}>
              <option value="no_result">No result (e.g. rain)</option><option value="abandoned">Abandoned</option><option value="walkover">Walkover / forfeit</option>
            </Select>
          </Field>
          {conclude.resultType === 'walkover' && (
            <Field label="Winning team"><Select value={conclude.winnerTeamId} onChange={(e) => setConclude({ ...conclude, winnerTeamId: e.target.value })}><option value="">Select…</option>{teamIds.map((t) => <option key={t} value={t}>{view.teams[t]?.name}</option>)}</Select></Field>
          )}
          <Button variant="danger" className="w-full" disabled={conclude.resultType === 'walkover' && !conclude.winnerTeamId}
            onClick={() => { send('conclude', { resultType: conclude.resultType, ...(conclude.resultType === 'walkover' ? { winnerTeamId: conclude.winnerTeamId } : {}) }, 'Conclude match'); onClose(); }}>
            Conclude match
          </Button>
        </div>
      )}
    </Modal>
  );
}

function ResultPanel({ view, matchId, onUndo, locked, refresh }) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const sugg = useApi(api, `/matches/${matchId}/player-of-match-suggestion`, [view.version]);
  const [potm, setPotm] = useState('');
  const [busy, setBusy] = useState(false);
  const players = useMemo(() => [...view.scorer.battingXI, ...view.scorer.bowlingXI], [view.scorer]);
  useEffect(() => { if (sugg.data?.suggestion && !potm) setPotm(sugg.data.suggestion.playerId); }, [sugg.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmed = view.match.resultConfirmed;

  const act = async (path, body, msg) => {
    setBusy(true);
    try { await api.post(`/matches/${matchId}/${path}`, body); toast(msg, 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Card className="space-y-3 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Result</p>
      <p className="text-xl font-bold text-emerald-700">{view.result?.text}</p>
      {confirmed ? (
        <>
          <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">Result confirmed. Points table and statistics have been updated.</p>
          {isAdmin && <Button variant="secondary" disabled={busy} onClick={() => { const r = window.prompt('Reason for reopening this match?'); if (r && r.length >= 3) act('reopen', { reason: r }, 'Match reopened for corrections'); }}>Reopen for correction (admin)</Button>}
        </>
      ) : (
        <>
          <Field label="Player of the match" hint={sugg.data?.suggestion ? `Suggested: ${sugg.data.suggestion.name}` : undefined}>
            <Select value={potm} onChange={(e) => setPotm(e.target.value)}><option value="">None</option>{players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          </Field>
          <Button className="w-full" size="py-3 text-base" disabled={busy} onClick={() => act('confirm-result', { playerOfMatch: potm || null }, 'Result confirmed')}>Confirm result</Button>
          <Button variant="secondary" className="w-full" disabled={locked || !view.undo} onClick={onUndo}>↶ Undo last ball (result not confirmed yet)</Button>
        </>
      )}
    </Card>
  );
}
