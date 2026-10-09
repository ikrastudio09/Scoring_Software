// Deterministic ball-by-ball commentary, generated locally from the match state.
//
// Pure: the same events always produce the same text (template variety is chosen by the ball's
// sequence number, not by randomness), so commentary is rebuildable at any time and can never
// affect scoring. No external services, no AI. Scorer edits are passed in as `overrides`
// (seq → text) and replace the generated sentence; the factual score line is never editable.

import { DISMISSAL_LABELS, formatOvers, runRate } from '@cricket/shared';
import { normalizeRules } from './rules.js';

const pick = (list, seq) => list[((seq * 2654435761) >>> 0) % list.length];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SHOT_PHRASE = {
  drive: 'driven', cover_drive: 'driven through the covers', straight_drive: 'driven straight',
  flick: 'flicked off the pads', pull: 'pulled', hook: 'hooked', cut: 'cut square', sweep: 'swept',
  reverse_sweep: 'reverse-swept', lofted: 'lofted', edge: 'off the edge', defence: 'defended', leave: 'left alone',
};

const DOT = ['no run.', 'no run, good ball.', 'dot ball.', 'no run, tight line.'];
const DOT_SHOT = { defence: ['no run, solidly defended.', 'no run, played back to the bowler.'], leave: ['no run, left alone outside off.'] };
const FOUR = ['FOUR! Finds the gap and races away.', 'FOUR! Too good for the field.', 'FOUR! Crisply struck to the rope.'];
const SIX = ['SIX! That has gone all the way.', 'SIX! Huge hit, into the crowd.', 'SIX! Cleared the rope with ease.'];
const RUNS = {
  1: ['1 run, pushed for a single.', '1 run, rotates the strike.', '1 run, quick single taken.'],
  2: ['2 runs, they come back for the second.', '2 runs, good running between the wickets.'],
  3: ['3 runs, excellent running.', '3 runs, chased down just short of the rope.'],
};

function outcomeText(ball, seq) {
  const shotName = ball.shot ? SHOT_PHRASE[ball.shot] : null;
  switch (ball.extra) {
    case 'wide': {
      const extraRuns = ball.total;
      return ball.runs ? `WIDE, ${plural(extraRuns, 'run')} added (${ball.runs} run).` : `WIDE. ${plural(extraRuns, 'extra')} added.`;
    }
    case 'noball': {
      const t = ball.noBallRunsType === 'bye' ? 'byes' : ball.noBallRunsType === 'legbye' ? 'leg byes' : null;
      if (ball.boundary === 6) return 'NO-BALL, and hit for SIX!';
      if (ball.boundary === 4) return 'NO-BALL, and hit for FOUR!';
      if (!ball.runs) return 'NO-BALL.';
      return t ? `NO-BALL, plus ${ball.runs} ${t}.` : `NO-BALL, ${plural(ball.runs, 'run')} off the bat.`;
    }
    case 'bye': return ball.runs === 4 ? '4 byes, beats everyone to the rope.' : `${ball.runs} bye${ball.runs === 1 ? '' : 's'}.`;
    case 'legbye': return ball.runs === 4 ? '4 leg byes, off the pad to the boundary.' : `${ball.runs} leg bye${ball.runs === 1 ? '' : 's'}.`;
    default: break;
  }
  if (ball.boundary === 6) return shotName ? `SIX! ${cap(shotName)} high over the rope.` : pick(SIX, seq);
  if (ball.boundary === 4) return shotName ? `FOUR! ${cap(shotName)} to the boundary.` : pick(FOUR, seq);
  if (ball.runs === 0) return (ball.shot && DOT_SHOT[ball.shot]) ? pick(DOT_SHOT[ball.shot], seq) : shotName ? `no run, ${shotName}.` : pick(DOT, seq);
  if (RUNS[ball.runs]) return shotName ? `${plural(ball.runs, 'run')}, ${shotName}.` : pick(RUNS[ball.runs], seq);
  return `${plural(ball.runs, 'run')}.`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function wicketText(ball, inn, meta) {
  const name = (id) => (id ? meta.players[id]?.name ?? 'Unknown' : null);
  const out = inn.batters[ball.wicket.batter];
  const d = out?.dismissal || { type: ball.wicket.type };
  const fielder = d.substituteFielder ? 'the substitute' : name(d.fielder);
  const bowler = name(ball.bowler);
  switch (ball.wicket.type) {
    case 'bowled': return `OUT! Bowled. ${bowler} hits the stumps.`;
    case 'caught': return `OUT! Caught by ${fielder}.`;
    case 'caught_and_bowled': return `OUT! Caught and bowled by ${bowler}.`;
    case 'lbw': return 'OUT! LBW, trapped in front.';
    case 'stumped': return `${ball.extra === 'wide' ? 'WIDE, and ' : ''}OUT! Stumped${fielder ? ` by ${fielder}` : ''}, beaten in the flight.`;
    case 'hit_wicket': return 'OUT! Hit wicket.';
    case 'run_out': {
      const done = ball.runs ? ` after ${plural(ball.runs, 'run')}` : '';
      return `${ball.extra === 'wide' ? 'WIDE, and ' : ball.extra === 'noball' ? 'NO-BALL, and ' : ''}OUT! ${name(ball.wicket.batter)} run out${fielder ? ` by ${fielder}` : ''}${done}.`;
    }
    default: return `OUT! ${name(ball.wicket.batter)}, ${(DISMISSAL_LABELS[ball.wicket.type] || ball.wicket.type).toLowerCase()}.`;
  }
}

function kindOf(ball) {
  if (ball.wicket) return 'wicket';
  if (ball.extra === 'wide') return 'wide';
  if (ball.extra === 'noball') return 'noball';
  if (ball.boundary === 6) return 'six';
  if (ball.boundary === 4) return 'four';
  if (ball.extra === 'bye') return 'bye';
  if (ball.extra === 'legbye') return 'legbye';
  return ball.runs === 0 ? 'dot' : 'runs';
}

/**
 * Every delivery of the match, oldest first:
 * { seq, innings, over: "16.4", kind, label, runs, text, edited, generated?, score, scoreText,
 *   milestones: [...], endOfOver?: { over, runs, wickets, score, text } }
 */
export function buildCommentary(state, setup, meta, overrides = new Map()) {
  const rules = normalizeRules(setup.rules);
  const bpo = rules.ballsPerOver;
  const name = (id) => (id ? meta.players[id]?.name ?? 'Unknown' : 'Unknown');
  const team = (id) => meta.teams[id]?.name ?? 'Unknown';
  const out = [];

  for (const inn of state.innings) {
    let runs = 0;
    let wickets = 0;
    let legal = 0;
    const batterRuns = new Map();
    const lastBall = inn.overs.at(-1)?.balls.at(-1);

    for (const over of inn.overs) {
      let overLegal = 0;
      for (const ball of over.balls) {
        // Ball number in cricket notation: an extra carries the number of the next legal ball.
        const ballNo = ball.legal ? overLegal + 1 : Math.min(overLegal + 1, bpo);
        if (ball.legal) overLegal += 1;
        runs += ball.total;
        legal += ball.legal ? 1 : 0;
        if (ball.wicket) wickets += 1;

        const milestones = [];
        if (ball.batRuns) {
          const before = batterRuns.get(ball.batter) || 0;
          const after = before + ball.batRuns;
          batterRuns.set(ball.batter, after);
          for (const m of [50, 100]) if (before < m && after >= m) milestones.push(`${m === 50 ? 'FIFTY' : 'HUNDRED'} for ${name(ball.batter)}!`);
        }
        if (ball.wicket) {
          const b = inn.batters[ball.wicket.batter];
          milestones.push(`${name(ball.wicket.batter)} ${b.runs} (${b.balls}). ${team(inn.battingTeam)} ${runs}/${wickets}.`);
        }

        const generated = `${name(ball.bowler)} to ${name(ball.batter)}, ${ball.wicket ? wicketText(ball, inn, meta) : outcomeText(ball, ball.seq)}`
          + (ball.freeHit ? ' (free hit)' : '');
        const custom = overrides.get(ball.seq);
        const score = `${runs}/${wickets}`;
        let scoreText = `${team(inn.battingTeam)} ${ball.total ? 'move to' : 'remain on'} ${score}.`;
        if (inn.target !== null) {
          const need = inn.target - runs;
          const left = inn.maxBalls - legal;
          if (need > 0 && left > 0) scoreText += ` Need ${need} from ${plural(left, 'ball')}.`;
        }

        const entry = {
          seq: ball.seq,
          innings: inn.number,
          over: `${over.index}.${ballNo}`,
          kind: kindOf(ball),
          label: ball.label,
          runs: ball.total,
          text: custom ?? generated,
          edited: custom !== undefined,
          score,
          scoreText,
          milestones,
        };
        if (custom !== undefined) entry.generated = generated;

        const overDone = over.completed && ball === over.balls.at(-1);
        if (overDone) {
          const crr = runRate(runs, legal, bpo);
          let text = `End of over ${over.index + 1}: ${plural(over.runs, 'run')}${over.wickets ? `, ${plural(over.wickets, 'wicket')}` : ''}. ${team(inn.battingTeam)} ${score}. CRR ${crr?.toFixed(2) ?? '-'}.`;
          if (inn.target === null && legal < inn.maxBalls && crr !== null) {
            text += ` Projected ${Math.round((runs / legal) * inn.maxBalls)}.`;
          }
          entry.endOfOver = { over: over.index + 1, runs: over.runs, wickets: over.wickets, score, text };
        }
        if (inn.status === 'COMPLETED' && ball === lastBall) {
          entry.milestones.push(`End of innings: ${team(inn.battingTeam)} ${score} (${formatOvers(legal, bpo)} ov).`);
        }
        out.push(entry);
      }
    }
  }
  return out;
}
