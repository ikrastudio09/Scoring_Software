// LED scoreboard. Receives an update after every ball (led:<matchId> room).
//   /led/                 follows the match currently in play (switches automatically)
//   /led/?match=<id>      pinned to one match
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi, createLiveConnection, ErrorBoundary, useConnectionStatus, useLiveMatch } from '@cricket/client';
import { fixed } from '@cricket/shared';
import './index.css';

const api = createApi();
const live = createLiveConnection({ client: 'led' });
const params = new URLSearchParams(window.location.search);
const PINNED = params.get('match');
const IN_PLAY = ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS', 'READY'];

/** Which match to show: pinned, or the first in-play match (re-checked on status changes). */
function useMatchId() {
  const [id, setId] = useState(PINNED);
  const [tournament, setTournament] = useState(null);
  useEffect(() => {
    let timer;
    const pick = async () => {
      try {
        const home = await api.get('/home');
        setTournament(home.tournament);
        if (!PINNED) {
          const order = ['LIVE', 'SECOND_INNINGS', 'INNINGS_BREAK', 'READY'];
          const next = [...home.live].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0];
          setId((cur) => {
            const curStillLive = home.live.some((m) => m.id === cur && IN_PLAY.includes(m.status));
            return curStillLive ? cur : next?.id || cur;
          });
        }
      } catch { /* keep showing what we have */ }
      timer = setTimeout(pick, 30000);
    };
    pick();
    const off = live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') { clearTimeout(timer); pick(); } });
    return () => { clearTimeout(timer); off(); };
  }, []);
  return { id, tournament };
}

/** Keep the display awake (Screen Wake Lock API, where supported). */
function useWakeLock() {
  useEffect(() => {
    let lock;
    const request = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ } };
    request();
    const onVis = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);
}

const FLASH = { SIX: ['SIX!', '#7c3aed'], FOUR: ['FOUR!', '#0284c7'], WICKET: ['WICKET!', '#dc2626'] };

function Flash({ envelope }) {
  const kind = envelope?.effects?.includes('WICKET') ? 'WICKET' : envelope?.effects?.includes('SIX') ? 'SIX' : envelope?.effects?.includes('FOUR') ? 'FOUR' : null;
  if (!kind || envelope.type === 'MATCH_STATE_UPDATED') return null;
  const [text, color] = FLASH[kind];
  return (
    <div key={envelope.version} className="pop pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <span className="rounded-[3vh] px-[6vw] py-[2vh] text-[22vh] font-black italic leading-none tracking-tight text-white shadow-2xl" style={{ background: color }}>{text}</span>
    </div>
  );
}

function BallDot({ label }) {
  const wicket = label.includes('W') && !label.includes('Wd');
  const bg = wicket ? '#dc2626' : label === '4' ? '#0284c7' : label === '6' ? '#7c3aed' : /Wd|Nb|B|LB/.test(label) ? '#b45309' : '#1f2937';
  return <span className="flex h-[10vh] min-w-[10vh] items-center justify-center rounded-full px-[1vh] text-[4.4vh] font-black tnum" style={{ background: bg }}>{label === '0' ? '•' : label}</span>;
}

function Batter({ b, striker }) {
  if (!b) return <div className="flex h-[9vh] items-center text-[5vh] text-white/30">—</div>;
  return (
    <div className="flex h-[9vh] items-center gap-[2vw]">
      <span className={`w-[3vw] text-[5vh] ${striker ? 'text-yellow-300' : 'text-transparent'}`}>▶</span>
      <span className="min-w-0 flex-1 truncate text-[6vh] font-bold uppercase">{b.name}</span>
      <span className="text-[7.5vh] font-black tnum text-yellow-300">{b.runs}</span>
      <span className="w-[10vw] text-left text-[4.5vh] tnum text-white/60">({b.balls})</span>
    </div>
  );
}

function Board({ view, envelope, tournament }) {
  const c = view.current;
  const teams = view.teams;
  if (!c) {
    const toss = view.match?.toss;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[3vh] text-center">
        <p className="text-[6vh] font-bold uppercase text-white/70">{tournament?.name}</p>
        <p className="text-[11vh] font-black uppercase leading-none">{teams[view.match.teamA]?.name} <span className="text-white/40">v</span> {teams[view.match.teamB]?.name}</p>
        {toss && <p className="text-[5vh] text-yellow-300">{teams[toss.winner]?.name} won the toss · chose to {toss.decision}</p>}
      </div>
    );
  }
  const batting = teams[c.battingTeam];
  const first = view.innings[0];
  const done = view.state === 'COMPLETED';
  const breakTime = view.state === 'INNINGS_BREAK';

  return (
    <div className="flex h-full flex-col px-[3vw] py-[2.5vh]">
      <div className="flex items-center justify-between text-[3.6vh] font-bold uppercase tracking-wide text-white/60">
        <span>{tournament?.shortName || tournament?.name} · Match {view.match.number}</span>
        <span>{teams[view.match.teamA]?.shortName} v {teams[view.match.teamB]?.shortName}</span>
      </div>

      <div className="mt-[1.5vh] flex items-end gap-[3vw]">
        <div className="flex h-[22vh] w-[1.2vw] rounded-full" style={{ background: batting?.color || '#fff' }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[7vh] font-black uppercase leading-none">{batting?.name}</p>
          <p data-testid="led-score" className="text-[24vh] font-black leading-[0.95] tnum">{c.runs}<span className="text-white/50">/</span>{c.wickets}</p>
        </div>
        <div className="pb-[2vh] text-right">
          <p className="text-[10vh] font-black leading-none tnum">{c.overs}</p>
          <p className="text-[4vh] uppercase text-white/60">overs of {c.maxOvers}</p>
          <p className="mt-[1vh] text-[4.5vh] tnum text-white/80">CRR {fixed(c.crr)}</p>
        </div>
      </div>

      <div className="mt-[1vh] flex min-h-[9vh] items-center rounded-[1.5vh] bg-white/10 px-[2vw] text-[5.4vh] font-bold">
        {done ? <span className="text-yellow-300">{view.result?.text}</span>
          : breakTime ? <span className="text-yellow-300">{view.superOver && c.target !== null ? 'SCORES LEVEL · SUPER OVER NEXT' : `INNINGS BREAK · TARGET ${c.runs + 1}`}</span>
            : c.target !== null ? <span>NEED <span className="text-yellow-300 tnum">{c.runsNeeded}</span> FROM <span className="text-yellow-300 tnum">{c.ballsRemaining}</span> BALLS<span className="ml-[2vw] text-[4.2vh] font-normal text-white/70">TARGET {c.target} · RRR {fixed(c.rrr)}</span></span>
              : <span className="text-white/70">{c.superOver ? `Super Over${c.superOver > 1 ? ` ${c.superOver}` : ''}` : first?.number === 1 && 'First innings'}{c.partnership ? ` · Partnership ${c.partnership.runs} (${c.partnership.balls})` : ''}</span>}
        {c.freeHit && !done && <span className="ml-auto rounded-[1vh] bg-amber-500 px-[1.5vw] text-[5vh] font-black text-black">FREE HIT</span>}
      </div>

      <div className="mt-[2vh] grid flex-1 grid-cols-2 gap-[3vw]">
        <div>
          <Batter b={c.striker} striker />
          <Batter b={c.nonStriker} />
        </div>
        <div className="flex flex-col justify-between">
          <div className="flex h-[9vh] items-center gap-[1.5vw]">
            <span className="min-w-0 flex-1 truncate text-[5.5vh] font-bold uppercase"><span className="mr-[1vw] text-[3.5vh] font-normal text-white/50">BOWLER</span>{c.bowler?.name || '—'}</span>
            {c.bowler && <span className="text-[6vh] font-black tnum">{c.bowler.wickets}-{c.bowler.runs} <span className="text-[4.5vh] font-normal text-white/60">({c.bowler.overs})</span></span>}
          </div>
          <div className="flex flex-wrap items-center gap-[1vw]">
            <span className="mr-[1vw] text-[4vh] uppercase text-white/50">This over</span>
            {c.thisOver.balls.map((b, i) => <BallDot key={i} label={b} />)}
          </div>
        </div>
      </div>
      {c.lastWicket && !done && <p className="truncate text-[3.8vh] text-white/60">Last wicket: {c.lastWicket.name} {c.lastWicket.runs} ({c.lastWicket.balls}) · {c.lastWicket.score}</p>}
      <Flash envelope={envelope} />
    </div>
  );
}

function App() {
  useWakeLock();
  const { id, tournament } = useMatchId();
  const status = useConnectionStatus(live);
  const { live: view, lastEnvelope, refresh } = useLiveMatch({ api, live, matchId: id, channel: 'led' });
  // Safety net: if the socket silently stalls, a periodic REST refresh still converges.
  useEffect(() => {
    if (!id) return undefined;
    const t = setInterval(() => { if (status !== 'connected') refresh(); }, 5000);
    return () => clearInterval(t);
  }, [id, status, refresh]);
  const dot = useMemo(() => (status === 'connected' ? 'bg-emerald-500' : 'animate-pulse bg-red-500'), [status]);

  return (
    <div className="relative h-full">
      {!id && <div className="flex h-full items-center justify-center text-[8vh] font-black uppercase text-white/70">{tournament?.name || 'Scoreboard'}<br /><span className="text-[4vh] font-normal">Waiting for the next match…</span></div>}
      {id && !view && <div className="flex h-full items-center justify-center text-[5vh] text-white/50">Loading…</div>}
      {view && <Board view={view} envelope={lastEnvelope} tournament={tournament} />}
      <span className={`absolute bottom-[1vh] right-[1vh] h-[1.2vh] w-[1.2vh] rounded-full ${dot}`} title={status} />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><ErrorBoundary autoReloadMs={5000}><App /></ErrorBoundary></StrictMode>);
