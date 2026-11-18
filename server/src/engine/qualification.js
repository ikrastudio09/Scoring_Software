// Qualification predictor. Pure: no I/O, deterministic.
//
// Mathematical statements are made only when PROVEN over every combination of the remaining
// results, on points:
//   SECURED      in every combination the team finishes inside the qualifying places outright
//                (fewer than `slots` other teams on as many points or more)
//   ELIMINATED   in every combination at least `slots` other teams finish strictly above it
// Teams level on points are separated by NRR / tie-breakers, which depend on scores that are not
// known in advance — such outcomes are reported as "depends on NRR", never as certain.
//
// Method. Fixing a team's own remaining matches is monotone: winning (with any bonus) is always its
// best case, losing to a bonus-point win its worst. Only the other matches need searching: an
// exact depth-first search with bounds, which stops as soon as a deciding combination is found.
// If the search exceeds its node budget the answer is "undetermined" and nothing is claimed.

/** Distinct points outcomes of one match: [pointsA, pointsB, code]. */
export function outcomes(rules) {
  const bonus = rules.bonus?.enabled ? (rules.bonus.points || 0) : 0;
  const list = [[rules.win, rules.loss, 'A'], [rules.loss, rules.win, 'B']];
  if (bonus > 0) list.push([rules.win + bonus, rules.loss, 'A+'], [rules.loss, rules.win + bonus, 'B+']);
  list.push([rules.tie, rules.tie, 'T']);
  if (rules.noResult !== rules.tie) list.push([rules.noResult, rules.noResult, 'N']);
  return list;
}

class Undetermined extends Error {}

/**
 * ∃ an assignment of `matches` (points added to `base`) such that the number of teams in `rivals`
 * whose points are ≥ x (strict: > x) is < k (mode 'fewer') or ≥ k (mode 'atLeast')?
 * Returns true / false; throws Undetermined when the node budget runs out.
 */
function exists({ base, rivals, matches, outs, x, strict, k, mode, budget }) {
  const pts = new Map(base);
  const over = (t) => (strict ? pts.get(t) > x : pts.get(t) >= x);
  // Most each rival can still add, for bounds.
  const maxGain = outs.reduce((m, [a, b]) => Math.max(m, a, b), 0);
  const left = new Map(rivals.map((t) => [t, 0]));
  for (const m of matches) {
    if (left.has(m.teamA)) left.set(m.teamA, left.get(m.teamA) + 1);
    if (left.has(m.teamB)) left.set(m.teamB, left.get(m.teamB) + 1);
  }
  let nodes = 0;
  const count = () => rivals.filter(over).length;
  const canStillPass = () => rivals.filter((t) => !over(t) && (strict ? pts.get(t) + left.get(t) * maxGain > x : pts.get(t) + left.get(t) * maxGain >= x)).length;

  const dfs = (i) => {
    if (++nodes > budget.limit) throw new Undetermined();
    const already = count(); // points only grow: teams over the line stay over it
    if (mode === 'atLeast') {
      if (already >= k) return true;
      if (already + canStillPass() < k) return false;
    } else {
      if (already >= k) return false;
      if (already + canStillPass() < k) return true;
    }
    if (i === matches.length) return mode === 'atLeast' ? already >= k : already < k;
    const m = matches[i];
    const inA = left.has(m.teamA);
    const inB = left.has(m.teamB);
    if (inA) left.set(m.teamA, left.get(m.teamA) - 1);
    if (inB) left.set(m.teamB, left.get(m.teamB) - 1);
    // Try the most promising outcomes first: push teams over the line ('atLeast') or keep them
    // under it ('fewer').
    const score = ([pa, pb]) => {
      const gainA = inA ? pa : 0;
      const gainB = inB ? pb : 0;
      return mode === 'atLeast' ? gainA + gainB : -(gainA + gainB);
    };
    for (const o of [...outs].sort((p, q) => score(q) - score(p))) {
      if (inA) pts.set(m.teamA, pts.get(m.teamA) + o[0]);
      if (inB) pts.set(m.teamB, pts.get(m.teamB) + o[1]);
      const hit = dfs(i + 1);
      if (inA) pts.set(m.teamA, pts.get(m.teamA) - o[0]);
      if (inB) pts.set(m.teamB, pts.get(m.teamB) - o[1]);
      if (hit) {
        if (inA) left.set(m.teamA, left.get(m.teamA) + 1);
        if (inB) left.set(m.teamB, left.get(m.teamB) + 1);
        return true;
      }
    }
    if (inA) left.set(m.teamA, left.get(m.teamA) + 1);
    if (inB) left.set(m.teamB, left.get(m.teamB) + 1);
    return false;
  };
  return dfs(0);
}

/** Points of `team` and its opponents after fixing all its matches with `pick(outs, isA)`. */
function fixTeam(base, team, own, pick) {
  const pts = new Map(base);
  for (const m of own) {
    const isA = m.teamA === team;
    const [pa, pb] = pick(m, isA);
    pts.set(m.teamA, (pts.get(m.teamA) ?? 0) + pa);
    pts.set(m.teamB, (pts.get(m.teamB) ?? 0) + pb);
  }
  return pts;
}

/**
 * Analyse one table (a group).
 * teams: [{ id, points, position }]   current points; position from the real (tie-broken) table
 * remaining: [{ id, number, teamA, teamB }]   counted fixtures not yet decided, in playing order
 * rules: { win, loss, tie, noResult, bonus: { enabled, points } };  slots: places that qualify
 * Returns { [teamId]: { status, ...flags } }.
 */
export function analyseQualification({ teams, remaining, rules, slots, budget = 200000, enumerateLimit = 50000 }) {
  const ids = teams.map((t) => t.id);
  const inGroup = new Set(ids);
  const base = new Map(teams.map((t) => [t.id, t.points]));
  const relevant = remaining.filter((m) => inGroup.has(m.teamA) || inGroup.has(m.teamB));
  const outs = outcomes(rules);
  const ptsOf = (o, isA) => (isA ? [o[0], o[1]] : [o[1], o[0]]); // as [team, opponent] for team = A/B
  // For `team`: its own best and worst outcome of a match (as [pA, pB] in match order).
  const bestFor = (isA) => {
    const o = [...outs].sort((p, q) => ptsOf(q, isA)[0] - ptsOf(p, isA)[0] || ptsOf(p, isA)[1] - ptsOf(q, isA)[1])[0];
    return [o[0], o[1]];
  };
  const worstFor = (isA) => {
    const o = [...outs].sort((p, q) => ptsOf(p, isA)[0] - ptsOf(q, isA)[0] || ptsOf(q, isA)[1] - ptsOf(p, isA)[1])[0];
    return [o[0], o[1]];
  };
  const plainWin = (isA) => (isA ? [rules.win, rules.loss] : [rules.loss, rules.win]);
  const result = {};
  const done = relevant.length === 0;

  for (const t of teams) {
    const own = relevant.filter((m) => m.teamA === t.id || m.teamB === t.id);
    const others = relevant.filter((m) => m.teamA !== t.id && m.teamB !== t.id);
    const rivals = ids.filter((id) => id !== t.id);
    const k = slots;
    const minPoints = fixTeam(base, t.id, own, (m, isA) => worstFor(isA)).get(t.id);
    const maxPoints = fixTeam(base, t.id, own, (m, isA) => bestFor(isA)).get(t.id);
    const r = { remaining: own.length, minPoints, maxPoints, undetermined: false };

    if (done) {
      r.status = t.position <= k ? 'QUALIFIED' : 'ELIMINATED';
      result[t.id] = r;
      continue;
    }
    if (rivals.length < k) { r.status = 'SECURED'; result[t.id] = r; continue; }

    const ask = (fixed, strict, mode) => {
      try {
        return exists({ base: fixed, rivals, matches: others, outs, x: fixed.get(t.id), strict, k, mode, budget: { limit: budget } });
      } catch (err) {
        if (!(err instanceof Undetermined)) throw err;
        r.undetermined = true;
        return null;
      }
    };
    const best = fixTeam(base, t.id, own, (m, isA) => bestFor(isA));
    const worst = fixTeam(base, t.id, own, (m, isA) => worstFor(isA));
    // Can it qualify — outright, or with tie-breaks in its favour?
    const outright = ask(best, false, 'fewer');
    const onTies = outright === true ? true : ask(best, true, 'fewer');
    // Can it miss out — outright (others strictly above), or on tie-breaks?
    const missOnTies = ask(worst, false, 'atLeast');
    const missOutright = missOnTies === false ? false : ask(worst, true, 'atLeast');
    r.canQualifyOutright = outright;
    r.canQualify = onTies;
    r.secured = missOnTies === false;
    r.safeUnlessTieBreak = missOutright === false;
    r.eliminated = onTies === false;

    // Winning every remaining match (no bonus): through regardless of other results?
    const winAll = fixTeam(base, t.id, own, (m, isA) => plainWin(isA));
    const winAllMiss = ask(winAll, false, 'atLeast');
    r.qualifiesIfWinsAll = winAllMiss === null ? null : !winAllMiss; // null = not proven either way
    // Must win the next match: every non-winning result of it ends its chances.
    r.mustWinNext = false;
    r.nextMatch = own[0] ? own[0].id : null;
    if (own.length && onTies !== false) {
      const next = own[0];
      const isA = next.teamA === t.id;
      const nonWins = outs.filter((o) => ptsOf(o, isA)[0] < rules.win);
      let alive = false;
      let unknown = false;
      for (const o of nonWins) {
        const fixed = fixTeam(base, t.id, own, (m, a) => (m === next ? [o[0], o[1]] : bestFor(a)));
        const v = ask(fixed, true, 'fewer');
        if (v === null) unknown = true;
        if (v) { alive = true; break; }
      }
      r.mustWinNext = !alive && !unknown && nonWins.length > 0;
    }

    if (r.secured) r.status = 'SECURED';
    else if (r.eliminated) r.status = 'ELIMINATED';
    else if (r.canQualifyOutright === false) r.status = 'NRR_ONLY';
    else if (r.safeUnlessTieBreak) r.status = 'NRR_DEPENDENT';
    else if (r.mustWinNext) r.status = 'MUST_WIN';
    else if (r.qualifiesIfWinsAll) r.status = 'IN_OWN_HANDS';
    else if (r.qualifiesIfWinsAll === false) r.status = 'WIN_AND_DEPEND';
    else r.status = 'IN_CONTENTION';
    result[t.id] = r;
  }

  // Share of all remaining combinations (each equally weighted) — only when small enough to count
  // exactly. Descriptive, not a forecast: real results are not equally likely.
  const combos = outs.length ** relevant.length;
  if (!done && combos <= enumerateLimit) {
    const tally = new Map(ids.map((id) => [id, { outright: 0, tieBreak: 0 }]));
    const pts = new Map(base);
    const walk = (i) => {
      if (i === relevant.length) {
        for (const id of ids) {
          const p = pts.get(id);
          let above = 0;
          let level = 0;
          for (const o of ids) {
            if (o === id) continue;
            if (pts.get(o) > p) above += 1; else if (pts.get(o) === p) level += 1;
          }
          if (above + level < slots) tally.get(id).outright += 1;
          else if (above < slots) tally.get(id).tieBreak += 1;
        }
        return;
      }
      const m = relevant[i];
      for (const o of outs) {
        pts.set(m.teamA, (pts.get(m.teamA) ?? 0) + o[0]);
        pts.set(m.teamB, (pts.get(m.teamB) ?? 0) + o[1]);
        walk(i + 1);
        pts.set(m.teamA, pts.get(m.teamA) - o[0]);
        pts.set(m.teamB, pts.get(m.teamB) - o[1]);
      }
    };
    walk(0);
    for (const id of ids) result[id].combinations = { total: combos, ...tally.get(id) };
  }
  return result;
}
