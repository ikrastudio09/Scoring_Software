// Operational integrity check. For every match with events: verify the event log (sequence
// continuity, UNDO targets), replay it through the engine, and compare with the stored match
// document. Run any time, including during the tournament (read-only unless --repair).
//
//   npm run verify:matches            report only
//   npm run verify:matches -- --repair  resync stale match documents from the event log
import { connectDb, disconnectDb } from '../src/db.js';
import { Match, MatchEvent } from '../src/models/index.js';
import { buildSetup, resolveEffective } from '../src/services/runtime.js';
import { replay, toSummary } from '../src/engine/index.js';
import { reconcileMatches, deriveStatus } from '../src/services/scoring.js';

await connectDb();
let problems = 0;
try {
  const matchIds = await MatchEvent.distinct('match');
  for (const id of matchIds) {
    const m = await Match.findById(id).lean();
    const events = await MatchEvent.find({ match: id }).sort({ seq: 1 }).lean();
    const label = `match ${m?.number ?? id}`;
    try {
      if (!m) throw new Error('events exist for a missing match');
      events.forEach((e, i) => { if (e.seq !== i + 1) throw new Error(`sequence gap at ${i + 1} (found ${e.seq})`); });
      const setup = buildSetup(m);
      if (!setup) throw new Error('events exist but setup is incomplete');
      const state = replay(setup, resolveEffective(events));
      const expectStatus = deriveStatus(state);
      const issues = [];
      if (m.stateVersion !== events.length) issues.push(`stateVersion ${m.stateVersion} ≠ ${events.length}`);
      if (m.status !== expectStatus) issues.push(`status ${m.status} ≠ ${expectStatus}`);
      const summary = toSummary(state, setup, { teams: {}, players: {} });
      const stored = (m.summary?.innings || []).map((i) => `${i.runs}/${i.wickets}`).join(' ');
      const derived = summary.innings.map((i) => `${i.runs}/${i.wickets}`).join(' ');
      if (stored !== derived) issues.push(`summary ${stored} ≠ ${derived}`);
      if (issues.length) { problems++; console.log(`✗ ${label}: ${issues.join('; ')}`); } else console.log(`✓ ${label}: ${derived} (${events.length} events)`);
    } catch (err) {
      problems++;
      console.log(`✗ ${label}: ${err.message}`);
    }
  }
  if (process.argv.includes('--repair')) console.log('repair:', await reconcileMatches());
  console.log(problems ? `${problems} match(es) need attention` : 'all matches consistent');
  process.exitCode = problems && !process.argv.includes('--repair') ? 1 : 0;
} finally {
  await disconnectDb();
}
