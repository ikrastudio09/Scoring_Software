// Load a tournament data file (tournament info, teams with players, fixtures) into the database.
// This is the clone point for a new tournament: edit data/tournament.json and import it.

import { Match, Player, Team } from '../../src/models/index.js';
import { updateTournament } from '../../src/services/tournament.js';
import { categoryConfig, ensureCategories, resolveCategory } from '../../src/services/categories.js';
import { ensureIdentities } from '../../src/services/identities.js';

/**
 * data.category (mens | ladies | kids, default mens) is the category the teams and fixtures belong
 * to; `category` in the options overrides it. Teams are matched by name and fixtures by number
 * within that category only.
 */
export async function importTournament(data, { log = console.log, category: categoryKey } = {}) {
  if (data.tournament) {
    await updateTournament(data.tournament);
    log(`tournament: ${data.tournament.name}`);
  }
  await ensureCategories();
  const category = await resolveCategory(categoryKey || data.category);
  const scope = { category: category._id };
  const { rules } = await categoryConfig(category);
  log(`category: ${category.name}`);
  const byShort = new Map();
  for (const team of data.teams || []) {
    const { players = [], ...fields } = team;
    const doc = await Team.findOneAndUpdate({ ...scope, name: fields.name }, { $set: { ...fields, ...scope } }, { upsert: true, new: true, runValidators: true });
    byShort.set(doc.shortName, doc);
    let created = 0;
    for (const p of players) {
      const exists = await Player.exists({ team: doc._id, name: p.name });
      if (!exists) { await Player.create({ ...p, ...scope, team: doc._id }); created++; }
    }
    log(`team ${doc.shortName.padEnd(5)} ${doc.name} (+${created} players)`);
  }
  for (const t2 of await Team.find(scope).lean()) byShort.set(t2.shortName, t2);

  let fixtures = 0;
  const { playersPerSide, ...ruleDefaults } = rules;
  for (const f of data.fixtures || []) {
    const teamA = f.teamA ? byShort.get(f.teamA)?._id : undefined;
    const teamB = f.teamB ? byShort.get(f.teamB)?._id : undefined;
    if ((f.teamA && !teamA) || (f.teamB && !teamB)) throw new Error(`Fixture ${f.number}: unknown team ${f.teamA} / ${f.teamB}`);
    const exists = await Match.exists({ ...scope, number: f.number });
    if (exists) continue;
    await Match.create({
      ...scope,
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
  await ensureIdentities();
  return { category: category.key, teams: (data.teams || []).length, fixtures };
}
