// Read projections of the engine state. Pure functions; `meta` supplies display names:
// meta = { matchId, teams: { [id]: { name, shortName, color } }, players: { [id]: { name } },
//         bonus: normalised bonus-point rules, or null when they do not apply to this match }

import { formatOvers, runRate, strikeRate, economy, RESULT_TYPES } from '@cricket/shared';
import { MATCH_STATE, currentInnings, bowlerUnavailableReason, nextInningsTeams } from './engine.js';
import { normalizeRules } from './rules.js';
import { bonusStatus } from './bonus.js';

const name = (meta, id) => (id ? meta.players[id]?.name ?? 'Unknown' : null);
const teamName = (meta, id) => meta.teams[id]?.name ?? 'Unknown';

export function resultText(result, meta) {
  if (!result) return null;
  switch (result.type) {
    case RESULT_TYPES.WIN:
      if (result.superOver) return `Match tied (${teamName(meta, result.winner)} won the Super Over)`;
      if (result.marginRuns !== undefined) {
        return `${teamName(meta, result.winner)} won by ${result.marginRuns} run${result.marginRuns === 1 ? '' : 's'}`;
      }
      return `${teamName(meta, result.winner)} won by ${result.marginWickets} wicket${result.marginWickets === 1 ? '' : 's'}`
        + (result.ballsRemaining ? ` (${result.ballsRemaining} ball${result.ballsRemaining === 1 ? '' : 's'} left)` : '');
    case RESULT_TYPES.TIE: return 'Match tied';
    case RESULT_TYPES.WALKOVER: return `${teamName(meta, result.winner)} won by walkover`;
    case RESULT_TYPES.ABANDONED: return 'Match abandoned';
    default: return 'No result';
  }
}

export function dismissalText(d, meta) {
  if (!d) return 'not out';
  const b = name(meta, d.bowler);
  const f = d.substituteFielder ? 'sub' : name(meta, d.fielder);
  switch (d.type) {
    case 'bowled': return `b ${b}`;
    case 'caught': return `c ${f} b ${b}`;
    case 'caught_and_bowled': return `c & b ${b}`;
    case 'lbw': return `lbw b ${b}`;
    case 'run_out': return f ? `run out (${f})` : 'run out';
    case 'stumped': return f ? `st ${f} b ${b}` : `st b ${b}`;
    case 'hit_wicket': return `hit wicket b ${b}`;
    case 'obstructing_field': return 'obstructing the field';
    case 'hit_ball_twice': return 'hit the ball twice';
    case 'retired_out': return 'retired out';
    case 'retired_hurt': return 'retired hurt';
    default: return d.type;
  }
}

/** The Super Over being played or about to start (1, 2, ...), or null during the main match. */
function superOverNumber(state) {
  const n = state.status === MATCH_STATE.INNINGS_BREAK ? state.innings.length + 1 : state.innings.length;
  return n > 2 ? Math.ceil((n - 2) / 2) : null;
}

function bonusView(state, bpo, meta) {
  return bonusStatus(state, meta.bonus, bpo, (id) => meta.teams[id]?.shortName || teamName(meta, id));
}

function inningsSummary(inn, bpo) {
  return {
    number: inn.number,
    superOver: inn.superOver ?? null,
    battingTeam: inn.battingTeam,
    bowlingTeam: inn.bowlingTeam,
    runs: inn.runs,
    wickets: inn.wickets,
    legalBalls: inn.legalBalls,
    overs: formatOvers(inn.legalBalls, bpo),
    target: inn.target,
    status: inn.status,
    endReason: inn.endReason,
  };
}

function batterLine(inn, id, meta) {
  if (!id) return null;
  const b = inn.batters[id];
  return { id, name: name(meta, id), runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes, sr: strikeRate(b.runs, b.balls) };
}

function bowlerLine(inn, id, meta, bpo) {
  if (!id) return null;
  const b = inn.bowlers[id];
  return {
    id, name: name(meta, id), overs: formatOvers(b.legalBalls, bpo), legalBalls: b.legalBalls,
    runs: b.runs, wickets: b.wickets, maidens: b.maidens, econ: economy(b.runs, b.legalBalls, bpo),
  };
}

function overView(over) {
  return { over: over.index + 1, runs: over.runs, wickets: over.wickets, balls: over.balls.map((b) => b.label), completed: over.completed };
}

/** Compact live view (~2–4 KB). Sent to LED, viewers and scorer. */
export function toLiveView(state, setup, meta) {
  const rules = normalizeRules(setup.rules);
  const bpo = rules.ballsPerOver;
  const inn = currentInnings(state);
  const view = {
    matchId: meta.matchId,
    version: state.version,
    state: state.status,
    rules: { oversPerInnings: rules.oversPerInnings, ballsPerOver: bpo, maxOversPerBowler: rules.maxOversPerBowler },
    teams: meta.teams,
    innings: state.innings.map((i) => inningsSummary(i, bpo)),
    current: null,
    lastEvent: state.lastEvent,
    result: state.result ? { ...state.result, text: resultText(state.result, meta) } : null,
    superOver: superOverNumber(state),
    bonus: bonusView(state, bpo, meta),
  };
  if (!inn) return view;

  const lastOver = inn.overs[inn.overs.length - 1];
  const thisOver = lastOver && (!lastOver.completed || state.status !== MATCH_STATE.IN_PROGRESS || inn.bowler === null)
    ? lastOver : null;
  const lastFow = inn.fallOfWickets[inn.fallOfWickets.length - 1];
  const lastOut = lastFow ? inn.batters[lastFow.batter] : null;
  const chasing = inn.target !== null;
  const runsNeeded = chasing ? Math.max(inn.target - inn.runs, 0) : null;
  const ballsRemaining = inn.maxBalls - inn.legalBalls;

  view.current = {
    inningsNumber: inn.number,
    superOver: inn.superOver ?? null,
    battingTeam: inn.battingTeam,
    bowlingTeam: inn.bowlingTeam,
    status: inn.status,
    runs: inn.runs,
    wickets: inn.wickets,
    legalBalls: inn.legalBalls,
    overs: formatOvers(inn.legalBalls, bpo),
    maxOvers: inn.maxBalls / bpo,
    extras: inn.extras.total,
    crr: runRate(inn.runs, inn.legalBalls, bpo),
    target: inn.target,
    runsNeeded,
    ballsRemaining,
    rrr: chasing && ballsRemaining > 0 ? runRate(runsNeeded, ballsRemaining, bpo) : null,
    freeHit: inn.freeHit,
    striker: batterLine(inn, inn.striker, meta),
    nonStriker: batterLine(inn, inn.nonStriker, meta),
    bowler: bowlerLine(inn, inn.bowler, meta, bpo),
    thisOver: thisOver ? overView(thisOver) : { over: inn.overs.length + 1, runs: 0, wickets: 0, balls: [], completed: false },
    recentOvers: inn.overs.filter((o) => o.completed).slice(-4).map(overView),
    partnership: inn.currentPartnership ? { runs: inn.currentPartnership.runs, balls: inn.currentPartnership.balls } : null,
    lastWicket: lastOut ? {
      name: name(meta, lastOut.id), runs: lastOut.runs, balls: lastOut.balls,
      howOut: dismissalText(lastOut.dismissal, meta), score: `${lastFow.runs}/${lastFow.wicket}`,
    } : null,
  };
  view.needs = needs(state, inn);
  return view;
}

function needs(state, inn) {
  if (state.status === MATCH_STATE.INNINGS_BREAK) return { startInnings: true };
  if (state.status !== MATCH_STATE.IN_PROGRESS) return {};
  return {
    batter: !inn.striker || !inn.nonStriker,
    bowler: !inn.bowler,
  };
}

/** Scorer view = live view + the selection lists the console needs. Admin only. */
export function toScorerView(state, setup, meta) {
  const view = toLiveView(state, setup, meta);
  const rules = normalizeRules(setup.rules);
  const inn = currentInnings(state);
  const between = state.status === MATCH_STATE.NOT_STARTED || state.status === MATCH_STATE.INNINGS_BREAK;
  const nextBatting = between ? nextInningsTeams(state, setup).battingTeam : inn?.battingTeam;
  const nextBowling = nextBatting === setup.battingFirst ? setup.bowlingFirst : setup.battingFirst;
  const live = inn && inn.status === 'IN_PROGRESS' ? inn : null;
  const opt = (id) => ({ id, name: name(meta, id) });

  view.scorer = {
    battingTeam: nextBatting,
    bowlingTeam: nextBowling,
    battingXI: setup.xi[nextBatting].map(opt),
    bowlingXI: setup.xi[nextBowling].map(opt),
    yetToBat: live
      ? setup.xi[live.battingTeam]
        .filter((id) => !live.batters[id] || live.batters[id].status === 'retired_hurt')
        .filter((id) => id !== live.striker && id !== live.nonStriker)
        .map((id) => ({ ...opt(id), returning: Boolean(live.batters[id]) }))
      : setup.xi[nextBatting].map(opt),
    bowlers: live
      ? setup.xi[live.bowlingTeam].map((id) => {
        const rec = live.bowlers[id];
        const reason = bowlerUnavailableReason(live, rules, id);
        return {
          ...opt(id),
          overs: formatOvers(rec?.legalBalls ?? 0, rules.ballsPerOver),
          runs: rec?.runs ?? 0,
          wickets: rec?.wickets ?? 0,
          oversStarted: rec?.oversStarted ?? 0,
          available: !reason,
          reason: reason?.message ?? null,
        };
      })
      : setup.xi[nextBowling].map((id) => ({ ...opt(id), overs: '0.0', runs: 0, wickets: 0, oversStarted: 0, available: true, reason: null })),
    overInProgress: Boolean(live && live.bowler && live.overs.at(-1)?.balls.length && !live.overs.at(-1).completed),
  };
  return view;
}

/** Full scorecard for every innings. */
export function toScorecard(state, setup, meta) {
  const rules = normalizeRules(setup.rules);
  const bpo = rules.ballsPerOver;
  return {
    matchId: meta.matchId,
    version: state.version,
    state: state.status,
    result: state.result ? { ...state.result, text: resultText(state.result, meta) } : null,
    superOver: superOverNumber(state),
    bonus: bonusView(state, bpo, meta),
    innings: state.innings.map((inn) => {
      let cumulative = 0;
      return {
        ...inningsSummary(inn, bpo),
        battingTeamName: teamName(meta, inn.battingTeam),
        extras: inn.extras,
        runRate: runRate(inn.runs, inn.legalBalls, bpo),
        batting: inn.battingOrder.map((id) => {
          const b = inn.batters[id];
          return {
            id, name: name(meta, id), runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes,
            sr: strikeRate(b.runs, b.balls), status: b.status,
            onStrike: inn.status === 'IN_PROGRESS' && id === inn.striker,
            dismissal: b.status === 'batting' ? 'not out' : dismissalText(b.dismissal, meta),
          };
        }),
        didNotBat: setup.xi[inn.battingTeam].filter((id) => !inn.batters[id]).map((id) => ({ id, name: name(meta, id) })),
        bowling: inn.bowlingOrder
          .filter((id) => inn.bowlers[id].legalBalls + inn.bowlers[id].wides + inn.bowlers[id].noBalls > 0)
          .map((id) => {
            const b = inn.bowlers[id];
            return {
              id, name: name(meta, id), overs: formatOvers(b.legalBalls, bpo), maidens: b.maidens, runs: b.runs,
              wickets: b.wickets, econ: economy(b.runs, b.legalBalls, bpo), dots: b.dots, wides: b.wides,
              noBalls: b.noBalls, fours: b.fours, sixes: b.sixes,
            };
          }),
        fallOfWickets: inn.fallOfWickets.map((f) => ({
          wicket: f.wicket, runs: f.runs, batter: f.batter, name: name(meta, f.batter), overs: formatOvers(f.legalBalls, bpo),
        })),
        partnerships: [...inn.partnerships, ...(inn.currentPartnership ? [{ ...inn.currentPartnership, endedBy: null }] : [])]
          .map((pt) => ({
            wicket: pt.wicket,
            runs: pt.runs,
            balls: pt.balls,
            unbroken: pt.endedBy !== 'wicket',
            batters: pt.batters.map((id) => ({ id, name: name(meta, id), ...pt.contributions[id] })),
          })),
        // Over-by-over progression (`overs` is the innings total, e.g. "9.4").
        overByOver: inn.overs.map((o) => {
          cumulative += o.runs;
          return { ...overView(o), bowlers: o.bowlers.map((id) => name(meta, id)), total: cumulative };
        }),
      };
    }),
  };
}

/**
 * Compact match summary stored on the match document for lists / results pages.
 * `innings` holds the two main innings only (NRR and team records use them); Super Overs are
 * listed separately.
 */
export function toSummary(state, setup, meta) {
  const bpo = normalizeRules(setup.rules).ballsPerOver;
  const line = (i) => ({
    team: i.battingTeam, runs: i.runs, wickets: i.wickets, legalBalls: i.legalBalls,
    overs: formatOvers(i.legalBalls, bpo), maxBalls: i.maxBalls, allOut: i.endReason === 'all_out',
  });
  const superOvers = state.innings.filter((i) => i.superOver).map((i) => ({ ...line(i), superOver: i.superOver }));
  return {
    innings: state.innings.filter((i) => !i.superOver).map(line),
    ...(superOvers.length ? { superOvers } : {}),
    resultText: resultText(state.result, meta),
  };
}
