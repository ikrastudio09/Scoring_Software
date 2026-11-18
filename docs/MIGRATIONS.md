# Database migrations

Every migration is **additive and idempotent**: it fills missing fields, never deletes documents,
never drops a collection and never rewrites the scoring event log (`matchevents`). Derived data
(`playermatchstats`, match `summary`) is rebuilt from events instead of being migrated.

Always take a backup first: `npm run backup -w server` (see DEPLOYMENT.md).

## M1 — Categories and the database active-match lock (Phase 2)

Runs automatically at server start (`server/src/index.js`), in this order:

| Step | What happens | Reversible? |
|---|---|---|
| `syncIndexes` (existing behaviour) | Drops the old **global** unique indexes `teams.name_1`, `teams.teamID_1`, `players.playerID_1`, `matches.number_1` and creates per-category ones: `(category, name)`, `(category, teamID)`, `(category, playerID)`, `(category, number)`. Existing data already satisfies them. | Yes — the old indexes can be recreated by hand |
| `ensureCategories` | Creates `mens`, `ladies`, `kids` for `tournament.currentSeason` (default **21**) if missing. | Yes |
| `migrateLegacyData` | Sets `category` = Men's on teams, players, matches and `playermatchstats` that have none. Logged as a warning with counts. | Yes (`$unset category`) |
| `repairActiveLock` | Creates / corrects the `activelocks` document from the match documents. | Yes (delete the document; it is re-derived) |

**Assumption:** data created before categories is Men's data. If any existing team actually
belongs to Ladies or Kids, move it **before** it has played (set `category` on the team, its
players and its fixtures together), or ask for a dedicated move script.

## M2 — Identities and the extended auction snapshot (Phase 3)

Runs automatically at server start, after M1:

| Step | What happens | Reversible? |
|---|---|---|
| new fields | `players.identity`, `age`, `previousSeason`, `history`; `teams.identity` — optional, absent on old documents | Yes |
| `ensureIdentities` | Every player and team without an identity gets a NEW one (`playeridentities`, `teamidentities`). Nothing is merged. Logged with counts. | Yes (`$unset identity`, drop the two new collections) |

Players imported before this release have no history: re-import the auction file (unchanged
players stay unchanged, history is added) or enter it in Admin → Players.

## M3 — Historical records (Phase 8)

New collections only: `historicalplayerseasons`, `historicalteamseasons`, `historicalimports`.
Nothing existing is changed. They stay empty until an admin imports a file.

### Check after deploying

```bash
mongosh cricket --eval 'db.categories.find({}, {key:1, season:1}).toArray()'
mongosh cricket --eval 'db.teams.countDocuments({category: null})'      # expect 0
mongosh cricket --eval 'db.players.countDocuments({identity: null})'     # expect 0
mongosh cricket --eval 'db.matches.getIndexes().map(i => i.name)'        # category_1_number_1, no number_1
curl -s https://<domain>/api/categories
```

Optional: **Admin → System → Rebuild statistics** (or `npm run stats:rebuild -w server`) rebuilds
every statistics row from the event log with its category. The migration already tags existing
rows, so this is only a consistency check.
