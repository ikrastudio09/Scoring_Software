// Load a tournament data file (tournament info, teams with players, fixtures) into the database.
// This is the clone point for a new tournament: edit data/tournament.json and import it.

import { Match, Player, Team } from '../../src/models/index.js';
import { getTournament, updateTournament } from '../../src/services/tournament.js';

export async function importTournament(data, { log = console.log } = {}) {
  if (data.tournament) {
    await updateTournament(data.tournament);
    log(`tournament: ${data.tournament.name}`);
  }
  const t = await getTournament();
  const byShort = new Map();
  for (const team of data.teams || []) {
    const { players = [], ...fields } = team;
    const doc = await Team.findOneAndUpdate({ name: fields.name }, { $set: fields }, { upsert: true, new: true, runValidators: true });
    byShort.set(doc.shortName, doc);
    let created = 0;
    for (const p of players) {
      const exists = await Player.exists({ team: doc._id, name: p.name });
      if (!exists) { await Player.create({ ...p, team: doc._id }); created++; }
    }
    log(`team ${doc.shortName.padEnd(5)} ${doc.name} (+${created} players)`);
  }
  for (const t2 of await Team.find().lean()) byShort.set(t2.shortName, t2);

  let fixtures = 0;
  const { playersPerSide, ...ruleDefaults } = t.rules;
  for (const f of data.fixtures || []) {
    const teamA = f.teamA ? byShort.get(f.teamA)?._id : undefined;
    const teamB = f.teamB ? byShort.get(f.teamB)?._id : undefined;
    if ((f.teamA && !teamA) || (f.teamB && !teamB)) throw new Error(`Fixture ${f.number}: unknown team ${f.teamA} / ${f.teamB}`);
    const exists = await Match.exists({ number: f.number });
    if (exists) continue;
    await Match.create({
      number: f.number,
      stage: f.stage || 'league',
      group: f.group,
      teamA,
      teamB,
      teamALabel: f.teamALabel,
      teamBLabel: f.teamBLabel,
      venue: f.venue,
      scheduledAt: f.scheduledAt ? new Date(f.scheduledAt) : undefined,
      rules: { ...ruleDefaults, ...(f.rules || {}) },
    });
    fixtures++;
  }
  log(`fixtures: +${fixtures}`);
  return { teams: (data.teams || []).length, fixtures };
}
