# MPL Season 21 — Implementation Progress

Tracks the enhancement of the existing scoring system into the MPL Season 21 platform
(Men's, Ladies and Kids tournaments). Updated at the end of every phase.

## Baseline (audit, 2026-11-03)

| Check | Result |
|---|---|
| `npm test` (server: engine, integration, realtime, full 81-match tournament) | **173 / 173 passed** (84 s) |
| `npm run build` (admin, viewer, LED) | all three built |
| Uncommitted changes at start | `apps/viewer/capacitor.config.json` (appId `score.ikrastudio.in`, name, splash colour), `apps/viewer/index.html` (title), `apps/viewer/.env.android.example` deleted — left untouched |

---

## Phase 1 — Audit

### 1. Existing architecture

A modular monolith, already shaped the way the brief asks for:

```
apps/admin    React 19 + Vite 6 + Tailwind 4   scorer console + management   /admin/
apps/viewer   same stack, PWA + Capacitor 7    public site + Android app     /
apps/led      same stack                       LED scoreboard                /led/
server        Express 5, Socket.IO 4, Mongoose 8, zod, pino, JWT
packages/shared  constants, overs/format helpers (protocol contract)
packages/client  API client, live socket connection with version guard, hooks
```

One Node process (PM2 `instances: 1`, fork mode), local MongoDB 8 standalone (no transactions),
nginx for TLS and WebSocket upgrades. Express serves all three built apps.

**Data model (today):**

| Collection | Role |
|---|---|
| `tournaments` | **singleton** (`key: 'main'`): name, branding, default rules, points rules, MVP weights |
| `teams` | `name` unique **globally**, `teamID` (auction) unique **globally** |
| `players` | `team` ref, `playerID` (auction) unique **globally**, auction snapshot (soldPoints, pool, status). Phone and Age are dropped on import |
| `matches` | `number` unique **globally**; setup (teams, toss, XIs, rules frozen per match) + derived cache (status, summary, result) |
| `matchevents` | **source of truth**, append-only; unique `(match, seq)` and `(match, clientEventId)` |
| `playermatchstats` | derived per-player-per-match rows (batting, bowling, fielding, MVP context); rebuildable |
| `commentaryedits` | scorer rewording keyed `(match, seq)` |
| `auditlogs`, `users` | admin audit, scorer/admin accounts |

**Scoring write path:** REST command → zod → per-match mutex → idempotency (`clientEventId`) →
optimistic version check (`expectedVersion`) → pure `engine.applyEvent` → journaled
`MatchEvent` insert (commit point) → match-document sync (non-fatal) → response → fire-and-forget
Socket.IO broadcast. Undo appends an `UNDO` event and **replays** the remaining effective events.

### 2. Features that already work (verified by the suite or by reading the code)

- **Scoring engine:** dot/1/2/3/4/6/5/7, wide, no-ball (bat/bye/leg-bye runs), bye, leg-bye,
  every dismissal type including run out of either batter, stumped off a wide, hit wicket,
  obstructing; free hit; over completion; strike rotation; new batter at the correct end;
  bowler eligibility (max overs, no consecutive overs, mid-over change); all-out by XI size;
  target / required rate; super over (knockouts); result and margins. 300 random matches are
  checked against invariants.
- **Undo** restores the full state (score, batter/bowler figures, strike, FOW, current over,
  commentary) because state is re-derived by replay, not by subtraction. The original event
  stays in the log.
- **Idempotency and ordering:** retries with the same `clientEventId` record nothing;
  stale `expectedVersion` → `409 STALE_STATE`; unique indexes make double commits impossible.
- **Realtime:** one envelope per event to LED + viewer rooms (every ball, not per over);
  strictly increasing `version`; client `isNewer()` guard; on every (re)connect, tab
  visibility or `online` event the client resubscribes and receives a full snapshot.
  `GET /api/live` gives a joining viewer state + recent commentary.
- **One live match:** process-wide activation lock + DB check; concurrent-start test exists.
  A finished-but-unconfirmed match also blocks the next start.
- **Commentary:** deterministic, local, template variety, milestones, end-of-over summaries,
  scorer edits stored separately; commentary failure cannot block the broadcast.
- **Statistics:** batting (runs, balls, avg, SR, HS, 4s, 6s, 30/50/100, ducks, dots, boundary %),
  bowling (overs, runs, wkts, avg, econ, SR, best, maidens, dots, boundaries conceded),
  fielding (catches incl. c&b, run outs, stumpings). Leaderboards incl. most runs / wickets.
- **MVP:** explainable impact score (weights configurable, auction value never an input),
  match top-5 with reasons, tournament MVP table.
- **Points table:** exact NRR (true decimal overs, all-out = full quota, configurable),
  configurable points, bonus point, tie-breakers (NRR, wins, head-to-head), groups.
- **Auction import:** JSON/CSV/XLSX parsed in the admin app, server-side validation,
  preview, content hash, confirm, idempotent re-import, phone never stored or exposed.
- **Security basics:** JWT roles (scorer/admin), helmet, CORS allow-list, rate limits,
  compression, explicit public field allow-lists, audit log, production config assertion.
- **Ops:** health endpoint, metrics, startup reconcile from the event log, `verify:matches`,
  `stats:rebuild`, mongodump backups, PWA, Android build docs.

### 3. Features that need modification

| Area | Today | Needed |
|---|---|---|
| Tournament scoping | Singleton tournament; every query and cache is global | `season + category` on teams, players, matches, stats; per-category rules/points/caches |
| Unique indexes | `Match.number`, `Team.name`, `Player.playerID`, `Team.teamID` unique globally | Compound with category (and season where relevant) — a Ladies team may reuse a name, match numbers restart per category |
| Active-match lock | In-process mutex + DB read. Correct for the single PM2 process, but not a DB-level guarantee | DB-level atomic claim on a global lock document (`findOneAndUpdate` conditional on "free"), released on confirm/abandon, stale-lock repair at startup — keep the in-process lock as a fast path |
| `/api/live`, home | No category in the payload | Include category so the global LIVE badge can say "Ladies — LIVE" |
| Auction import | Players without `playerID` are **linked by team + name** automatically | Violates "never merge by name": turn into an explicit admin mapping step |
| Auction snapshot | No Age, no historical aggregates | Add `Age` (stored, never public), `previousYearPerformance`, `overallPreviousPerformance` |
| Orange / Purple Cap | `mostRuns` / `mostWickets` lists, no tie ranks; thresholds hard-coded (`QUALIFY`) | Dedicated cap tables with shared ranks for ties; thresholds in tournament rules |
| Player profile | Current-season career + match log | Add Previous Year, Overall Previous and Career blocks (kept separate) |
| Docs | README says super over is "not in V1" but it is implemented | Correct the docs |

### 4. Missing features

- Season and category entities; category home page with three cards, switcher, deep links
  (`/mens/...`, `/ladies/...`, `/kids/...`), remembered last category.
- Global LIVE indicator showing the category.
- Tournament Centre per category (overview totals, records incl. highest successful chase,
  best win margin, longest winning streak, leaderboards, historical comparison).
- Qualification predictor (exhaustive enumeration of remaining results; guaranteed / possible /
  NRR-dependent) and what-if simulator.
- Historical MPL data: player identities across seasons, team identity mapping, season records
  and aggregates, import workflow with column/season/category/identity mapping.
- Central branding config (logo across favicon, PWA, Android, LED, admin), branded launch loader.
- Admin pages: categories/seasons, per-category rules and qualification slots, identity
  mapping, audit log viewer, historical import.

### 5. Database migration risks

1. **Old unique indexes are not dropped by Mongoose.** Adding a compound index leaves the old
   global `number_1` / `name_1` / `playerID_1` / `teamID_1` indexes in place, so the first Ladies
   match "Match 1" or a shared team name fails with a duplicate-key error. Needs an explicit,
   idempotent migration script (create new index → backfill → drop old index; never drop a
   collection).
2. **Backfilling `category` onto existing documents** — which category does the existing data
   belong to? (Question below.)
3. **Installed Android APKs** call `/api/home`, `/api/points-table`, `/api/stats/...` without a
   category. Those endpoints must keep working (default category) until users update.
4. **Derived data** (`playermatchstats`, match `summary`) is rebuildable, so it is backfilled by
   `stats:rebuild` rather than migrated by hand. Source data (`matchevents`) is never touched.
5. Moving rules from the tournament singleton to categories: matches already freeze their rules,
   so played matches cannot change; the singleton stays as the season default.

### 6. Scoring / realtime issues found

No scoring-correctness defect was found in this audit. The engine is backed by 79 unit tests,
super-over tests and the random-match invariant suite. A line-by-line engine review is
scheduled for Phase 4. Items to address:

| # | Severity | Issue |
|---|---|---|
| R1 | Medium — **fixed in Phase 2** | One-active-match is enforced in-process only. If PM2 were ever switched to cluster mode, or a second process started by mistake, two matches could go live. Fix: DB-level lock (Phase 2). |
| R2 | Low | `rebuildMatchStats` does `deleteMany` then `insertMany`; a crash in between leaves one match without stats until `stats:rebuild`. Derived data, so recoverable; can be made upsert-based. |
| R3 | Low — **fixed in Phase 3** | Auction import name-linking (above). |
| R4 | Low — **fixed in Phase 2** | Stats and points caches are global; after categories they must be keyed by category, or a Ladies confirmation would rebuild Men's caches (correct but wasteful) — and, worse, any unscoped query would mix categories. |
| R5 | Info | `apps/viewer/.env.android.example` is deleted in the working tree but referenced by docs/ANDROID.md. |

### 7. Recommended implementation order

The brief's order works, with three adjustments:

1. **Phase 2 (categories) before everything else**: every later feature reads category-scoped
   data, so the scoping and the index migration must land first.
2. **Phase 3 defines the reusable `performance` schema** that Phase 8 (historical import) reuses,
   so historical aggregates have one shape from the start.
3. **Phase 4 is mostly verification** (the engine is already sound): engine review, the DB lock
   edge cases, and the new realtime tests the brief lists. **Phase 9 branding/loader** is small
   and independent; it can move earlier if the logo arrives.
4. **Phase 8 (historical) depends on sample files.** The import design waits until real files
   have been inspected.

---

## Decisions (owner, 2026-11-03)

1. **playerID is unique per category of one season only**, and the same person does **not** keep
   the same playerID across seasons. One auction app serves all categories. → playerID is only an
   import key inside (season, category); a separate permanent player identity with
   admin-assisted mapping is needed (Phase 3). Never merge by name or phone.
2. **Historical data is not available yet.** Build the provision (models, import, admin
   maintenance) now; the owner may adjust the models before production. The men's player list
   format (MPL-2025 PDF) is the reference:
   `Previous Statistics = "ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3"`.
   Findings from that file, to handle in Phase 3:
   - **ASD includes the previous year** (one-season players have ASD = 2024 exactly), so
     *overall previous* = ASD − previous year for counting fields (S, M, R, W, C).
   - **ASD `MOM` equals the previous year's matches in every row** — almost certainly a shifted
     column in the export; import it flagged as unreliable, never silently.
   - Only S, M, R, W, C, MOM exist — no balls, overs, not-outs: averages / strike rates /
     economies for previous seasons cannot be computed and are not shown.
   - Phones repeat (#66/#67, #107/#117), names have typos (MAHHESH, "TEAM CHALLEGER"), Age 1
     (#135): neither phone nor name is an identity; validation warns on implausible ages.
3. **Existing data** (not answered explicitly): assumed to be Men's / test data → the Phase 2
   migration assigns it to Men's (docs/MIGRATIONS.md).

Assumptions (documented, reversible): match numbers restart per category; rules, points and
qualification slots are configurable per category; Age is stored but never public.

---

## Phase 2 — Tournament foundation ✅ (2026-11-03)

**Features**
- `categories` (Men's / Ladies / Kids) of the current season (default 21), created at startup.
- Teams, players, matches and statistics rows carry `category`; every list, points table,
  leaderboard, MVP table, team record and cache is per category. Same team name / playerID /
  match number may exist in different categories, never twice in one. Fixtures cannot pair teams
  from two categories; players cannot move between categories.
- Category settings = season defaults + category overrides (rules, points, MVP weights,
  leaderboard thresholds, qualification slots). Admin UI: Settings → "<Category> settings".
- **Global one-live-match lock in the database** (`activelocks`): atomic conditional claim
  before the first event is committed, released on confirmation or when an undo returns the
  match to "ready", re-derived at startup and on demand (Admin → System → Repair live-match lock).
  The existing in-process checks stay as the fast path. Errors name the category
  ("Men's Match 7 is currently live …", `details.activeCategory`).
- Viewer: landing page with three category cards + the live match; `/:category/...` routes;
  category switcher; global LIVE pill naming the category; "live in another category" notice;
  last category remembered; old links redirect; entity pages correct a wrong category prefix.
- Admin: category selector in the header (remembered per device); matches, fixtures, teams and
  auction import work on the selected category; the dashboard shows the live match of any
  category. LED follows the live match of any category and labels it.
- Compatibility: requests without `?category` get Men's (installed Android apps keep working).

**Files created:** `server/src/models/Category.js`, `server/src/models/ActiveLock.js`,
`server/src/services/categories.js`, `server/test/integration/categories.test.js`,
`apps/viewer/src/lib/category.jsx`, `apps/viewer/src/pages/Landing.jsx`,
`apps/admin/src/lib/category.jsx`, `docs/MIGRATIONS.md`.

**Files modified:** models (Team, Player, Match, PlayerMatchStat, Tournament, index), services
(active, scoring, matches, runtime, points, stats, auctionImport), routes (catalog, matches,
misc), `validation.js`, `index.js`, scripts (seed, import-tournament, lib/importer), test harness;
viewer (main, Layout, Home, Points, Matches, Stats, Teams, Players, MatchPage, MatchCard, ui);
admin (main, Dashboard, Fixtures, Teams, Import, MatchSetup, Settings); LED main; e2e specs;
docs (README, ARCHITECTURE, API, REALTIME_EVENTS, ANDROID).

**Database changes:** see docs/MIGRATIONS.md (M1). New collections `categories`, `activelocks`.

**API changes:** `GET /categories`, `GET|PUT /categories/:key`, `GET /overview`,
`GET /admin/active-lock`, `POST /admin/active-lock/repair`; `?category=` on `/home`,
`/points-table`, `/stats/*`, `/teams`, `/players`, `/matches`; `category` in team/match creation,
auction import, `/live`, live views and tournament-room events. See docs/API.md.

**Tests:** `npm test` → **183 / 183 passed** (10 new: category separation of teams, fixtures,
points tables, leaderboards, MVP; rule overrides; legacy migration; cross-category live block
with a clear error; simultaneous starts in two categories; database lock refusing a second claim
with in-process checks bypassed; lock release on undo and confirmation; stale-lock repair; admin
endpoints). `npm run test:e2e` → **13 / 13 passed** (updated for the landing page; old links
verified to redirect). `npm run build` → all three apps built. Screens checked at 390 px and
1280 px against the existing design.

**Known issues / remaining:** MVP weights on the Settings page edit the season default;
per-category weights are API-only for now. Season switching is **out of scope** (owner: no season
change during the tournament); `currentSeason` stays 21.

---

## Phase 3 — Player and team data ✅ (2026-11-03)

**Features**
- **One editable definition of a performance aggregate** (`packages/shared/src/performance.js`:
  `PERFORMANCE_FIELDS`, `STAT_CODES`). The Mongoose sub-schema, request validation, the
  "Previous Statistics" parser, the import preview and the admin editor are all generated from it,
  so the owner can change the statistics kept before production in one place.
- **Auction snapshot v2**: `Age` (stored, admin-only, never in public APIs; implausible values such
  as `1` are warned and not stored), `previousTeam` / `previousTeamPoints` (`NULL`/`N/A` = none),
  `playerPhone` / `Mobile No.` never stored. PDF column headings work as-is.
- **Two separate historical aggregates** per season record: `history.previousYear` and
  `history.overallPrevious`, read from structured fields or parsed from the
  `ASD:- … | 2024:- …` text. Overall previous = ASD − previous year (exact for counting fields);
  negative or inseparable fields are dropped and flagged; the broken ASD `MOM` column is detected
  and not imported; no rate is ever computed without real denominators. Season metadata:
  previous year = season 20, overall previous = up to season 19.
- **Import workflow** keeps upload → validation → preview → errors/warnings → hash-checked
  confirmation → summary, and now shows each player's last-season / before-last-season figures
  and notes. Problems are summarised once per kind.
- **No merging by name**: the old automatic "link existing player with the same name" became an
  explicit per-player "same person?" checkbox in the preview.
- **Permanent identities**: `playeridentities` / `teamidentities`. Every new season record gets a
  new identity; an admin links records (Admin → Players → Player / Team identities) using
  name-based suggestions (labelled, never applied) or a search. One person cannot have two records
  in one category; links can be undone; emptied identities are marked merged, never deleted;
  linked team names are kept as aliases. All link actions are audited.
- **Admin maintenance** (Admin → Players → Previous performance): view age, previous team, both
  aggregates and import notes; correct them by hand with a mandatory reason (audited with
  before/after, `source: manual`, kept by later re-imports).
- Career combination helper (`combinePerformances`): sums only fields every part has, reports
  partial fields — ready for the profile pages (Phase 5).

**Files created:** `packages/shared/src/performance.js`, `server/src/models/performance.js`,
`server/src/models/PlayerIdentity.js`, `server/src/models/TeamIdentity.js`,
`server/src/services/identities.js`, `server/src/routes/people.js`,
`server/test/unit/performance.test.js`, `server/test/integration/people.test.js`,
`apps/admin/src/pages/People.jsx`, `docs/IMPORT_FORMATS.md`.

**Files modified:** `packages/shared/src/index.js`, models (Player, Team, index), services
(auctionImport), routes (catalog, misc), `validation.js`, `app.js`, `index.js`,
`scripts/lib/importer.js`, tests (auctionImport unit, live-ops), admin (main, Import),
`data/auction.example.json`, docs (README, API, ARCHITECTURE, MIGRATIONS).

**Database changes:** M2 in docs/MIGRATIONS.md — new optional fields, new collections
`playeridentities`, `teamidentities`, one new identity per existing player and team.

**API changes:** `GET /admin/players`, `PUT /admin/players/:id/history`,
`GET /admin/identities/players[/search|/:id]`, `POST /admin/players/:id/identity`,
`GET /admin/identities/teams`, `POST /admin/teams/:id/identity`; import preview/commit accept
`links` and return per-player history and candidates. Public player APIs unchanged (no age).

**Tests:** `npm test` → **204 / 204 passed** (21 new: parser and derivation on real PDF rows,
career combination and rates, PDF-style sheet columns, unreadable text; import with history and
flags, seasons metadata, privacy of age/phone in public APIs, idempotent re-import, manual
correction kept by re-import, structured blocks, same playerID in two categories, identity
suggest/link/conflict/split/merged-id resolution, team identity link + alias, admin-only access).
`npm run test:e2e` → **13 / 13**. `npm run build` → all built. Admin Import and Players screens
checked visually.

**Known issues / remaining:**
- Previous performance is maintained and stored but not yet shown publicly; the player profile
  (Previous Year / Overall Previous / Career blocks) is Phase 5.
- In the previous-year segment a missing code (e.g. no `MOM`) is stored as unknown, not 0 —
  the export omits zero values, so those fields show "—" until confirmed.
- Historical season-by-season imports (Phase 8) will reuse the same aggregate schema and the
  identities; the rule against double counting (season records vs. auction aggregates) is
  designed there.

---

## Phase 4 — Scoring and realtime reliability ✅ (2026-11-03)

**Engine review (line by line: engine.js, rules.js, views chase figures, commentary).** Confirmed
correct against the Laws / ICC playing conditions: wide and no-ball penalties and runs, byes/leg
byes (legal, not charged to the bowler), strike on odd runs and at over end, new batter at the
striker's end after a catch, dismissals allowed per delivery type, part overs counting toward the
bowler limit and no consecutive overs, maidens (single bowler, nothing conceded), all-out by XI
size, target / required runs / RRR, results and margins, Super Over pairing, free-hit carry-over.

**Defects found and fixed**
1. **A wide on a free hit allowed a stumping or hit wicket.** On a free hit the striker can only be
   out as off a no-ball, even if the delivery is a wide. Fixed in the engine (`rules.js`) and the
   scorer console's dismissal picker. Regression test fails on the old rule.
2. **Stumpings could be saved without the wicketkeeper**, so stumpings were missing from fielding
   statistics. A stumping now needs the keeper (or "substitute"), like a catch — engine,
   console ("Select wicketkeeper…") and API.

**Improvements**
- Every ball message now names the batter, bowler, extras (type + runs) and wicket, in addition to
  event id, match id, sequence, innings, over, runs, score, timestamp and commentary.
- Deterministic commentary: maiden overs ("A maiden over. Excellent bowling."), three- and
  five-wicket hauls, hat-tricks (three consecutive deliveries by the bowler, credited wickets only),
  and the match-winning line from the engine's own result.

**Verified (new tests)**
- **Undo restores everything clients see**: for 18 kinds of command (start, dot, single, four,
  six, wide, no-ball, bye on a free hit, leg bye completing the over, bowler change, bowled, new
  batter, run out after a run, retired hurt, swap strike, stumped) the scorer view, live view,
  scorecard and full commentary are identical before the command and after its undo; the log keeps
  every original plus each undo. (The engine-level property — undo ≡ replay of the prefix — was
  already checked over 300+ random matches.)
- Undo of a wicket restores batting, bowling, fall of wickets and partnerships.
- A retried request and a stale double-tap broadcast **nothing**: exactly one socket message per
  recorded event.
- **LED** network drop: reconnect + resubscribe yields one snapshot with the latest score (no
  replay of missed balls), then every next ball arrives.
- **Client version guard** (`isNewer`): stale, duplicate and out-of-order messages are dropped,
  same-version snapshots replace in place, undo (a newer version) always applies.

**Decisions**
- Commentary is published with the ball (no hold-back for editing), because holding it would
  delay every-ball updates; scorer edits replace the sentence everywhere within a second
  (`COMMENTARY_UPDATED`). This keeps commentary from ever blocking scoring.

**Files modified:** `server/src/engine/{rules,engine,commentary}.js`, `server/src/realtime/hub.js`,
`packages/shared/src/constants.js`, `apps/admin/src/pages/ScoringConsole.jsx`, tests
(`test/engine/commentary.test.js`), docs (ARCHITECTURE, API, REALTIME_EVENTS).
**Files created:** `server/test/engine/laws.test.js`, `server/test/integration/reliability.test.js`.
**Database / API changes:** none, except that `stumped` now requires `fielderId` or `substituteFielder`.

**Tests:** `npm test` → **219 / 219 passed** (15 new). `npm run test:e2e` → **13 / 13**.
`npm run build` → all built.

**Open question for the owner (not changed):** byes / leg byes run off a **no-ball**. The engine
records them as byes / leg byes, not charged to the bowler (common club scoring). The MCC Laws
(21.10) score them as **no-ball extras charged to the bowler**. This changes bowler figures and
economy, so it should be a deliberate, configurable choice per tournament.

**Known limitations (documented, unchanged):** a non-striker run out before the ball is
delivered (dead ball, no delivery counted) cannot be recorded as such; the end at which a run-out
batter is replaced follows the runs completed — the scorer can correct the strike with "Swap
strike".

---

## Phase 5 — Statistics and profiles ✅ (2026-11-03)

**Features**
- **Orange Cap / Purple Cap** per category: dedicated tables (runs, matches, innings, average,
  strike rate, 4s, 6s / wickets, matches, overs, economy, average, strike rate, best). Players level
  on runs (wickets) are **joint holders** with the same rank ("1="); within a tie they are listed by
  strike rate (economy), then name — the order never changes the rank. Eligibility
  (`capMinMatches`) is configurable per category (Admin → Settings).
- **Competition ranking everywhere** (`rankRows`): every leaderboard and the MVP table share ranks
  on ties (1, 1, 3) and never cut a shared place at the top-10 boundary.
- **Fielding leaderboard**: catches + run outs + stumpings.
- **Player profile**: awards row (Orange / Purple Cap holder, player-of-the-match count, match MVP
  awards); **Performance by season** table — this season, previous year, overall previous and a
  career row — kept as separate rows; career sums only fields every period supplies and says so;
  rates appear only from real denominators. Shown even before the player's first match.
- **Team profile**: runs scored and conceded, lowest total, overs bowled, maidens, dot balls,
  run outs / stumpings added to the existing record, leaders, squad and results.
- Home page leader cards are now the Orange and Purple Cap.
- MVP reviewed: match MVP top five with reasons, tournament MVP table and component breakdown
  already met the brief (runs, tempo, boundaries, wickets, economy, dots, catches, run outs,
  stumpings, chase/defence context; auction value never used).

**Files created:** `server/test/integration/stats-profiles.test.js`.
**Files modified:** `server/src/services/{stats,categories}.js`, `server/src/models/Category.js`,
`server/src/validation.js`, viewer (`pages/Stats.jsx`, `pages/Players.jsx`, `pages/Teams.jsx`,
`pages/Home.jsx`), admin (`pages/Settings.jsx`), tests (`tournament.test.js`, e2e
`scoring.spec.js`), docs (API).
**Database changes:** optional `categories.leaderboards.capMinMatches`.
**API changes:** `orangeCap`, `purpleCap`, `mostDismissals`, `rank` / `tied` on leaderboard rows;
`awards` and `history` on `GET /players/:id`.

**Tests:** `npm test` → **226 / 226** (7 new: ranking with ties and cut-off, profile blocks and
career rules, joint Orange / Purple Cap holders with shared rank and display order, keeper
stumping on the fielding board, configurable eligibility, profile history + awards through the
API without private fields). `npm run test:e2e` → **13 / 13**. Builds OK. Stats and profile
pages checked at 390 px and 1280 px (a cap-table layout issue on phones was found and fixed).

---

## Phase 6 — Tournament Centre ✅ (2026-11-03)

**Features**
- `GET /api/tournament-centre?category=` and the viewer page **/:category/centre** ("Centre" in
  the navigation, also in the phone's bottom bar).
- **Overview**: matches played / total, remaining, runs, wickets, fours, sixes, extras, overs bowled,
  50+ scores. Extras = team runs − runs off the bat (exact, works for matches recorded earlier).
- **Player records**: highest individual score, best bowling, most runs / wickets / fours / sixes /
  catches, best batting average / strike rate / economy (same thresholds as the leaderboards),
  most valuable player.
- **Team records**: highest team total, lowest *completed* total (all out or full overs), highest
  successful chase (with target), biggest wins by runs and by wickets (balls to spare break a tie),
  most wins, most points, best NRR, longest winning streak (any non-win ends a streak; "ongoing"
  shown).
- **Leaderboards**: Orange / Purple Cap, MVP, batting, bowling, fielding (top 5, shared ranks).
- Every record shows **all** holders when level. Super Overs never count. Strictly per category.
- Built from the per-category statistics and points caches plus one fixtures query; 5-second
  response cache. No charts — tiles, record lists and tables only.
- **Historical comparisons**: a labelled placeholder until previous seasons are imported; the data
  model and import arrive in Phase 8, which fills this section.

**Files created:** `server/src/services/centre.js`, `server/test/integration/centre.test.js`,
`apps/viewer/src/pages/Centre.jsx`.
**Files modified:** `server/src/routes/misc.js`, viewer `main.jsx`, `components/Layout.jsx`, docs (API).
**Database changes:** none.

**Tests:** `npm test` → **232 / 232** (6 new: team records incl. completed-only lowest total,
wicket-margin tie-break and streak broken by a no result; shared records; exact overview totals
over two hand-scored matches incl. extras and overs; category isolation). `npm run test:e2e` →
**13 / 13**. Builds OK. Page checked at 1280 px and 390 px (record labels narrowed on phones).

---

## Phase 7 — Qualification predictor and what-if ✅ (2026-11-03)

**Mathematical approach**
- Only statements proven over **every** combination of the remaining counted fixtures are
  presented as certain: *Qualification secured* (league running) / *Qualified* (league over),
  *Eliminated*. Points outcomes per match come from the category's rules (win, loss, tie, no
  result, bonus point); identical outcomes are merged.
- Teams finishing **level on points** are always "decided by NRR (then wins, head-to-head)" — never
  certain, since NRR depends on scores not yet known: *Qualification depends on NRR* (only a level
  finish can put them out / can at best finish level).
- *Must win* (every non-winning result of the next match ends their chances), *Win and depend on
  other results* (winning every match is not enough on its own), *In their own hands* (winning
  every match guarantees a place), *In contention*.
- Method: fixing a team's own matches at its best / worst is monotone; the other matches are
  searched exactly with bounds and early exit. A work budget prevents slow requests; if it is
  exceeded the team stays *In contention* — **nothing is guessed** (tested).
- When the remaining combinations are few (≤ 50 000), the share of combinations in which each team
  is through on points / level on points is shown — clearly as a description, not a forecast.
- **Verified against brute force** on 300 random leagues (4–6 teams, 2–6 matches, 1–4 places, bonus
  on/off, tie ≠ no result): every flag equals the exhaustive answer.
- Performance (16 teams × 4 matches): < 30 ms at any stage; 5-second response cache.

**What-if calculator**: pick results for any open league fixtures (win / tie / no result, bonus
point), optionally with scores. The server recomputes the table and the predictions **in memory
only** (tested: points table, match documents and event log unchanged). A simulated score moves
NRR; a simulated win or tie without a score is listed as excluded from NRR rather than guessed.
Scores are checked for consistency. "Reset to actual standings" returns to reality. Clearly
labelled HYPOTHETICAL. Rate limited per IP.

**Viewer**: `/:category/qualification` (links from the points table and the Tournament Centre):
Current / What-if tabs, a status badge and one-line explanation per team, the qualifying line,
and a "how to read this" note on certainty.

**Files created:** `server/src/engine/qualification.js`, `server/src/services/qualification.js`,
`server/test/engine/qualification.test.js`, `server/test/integration/qualification.test.js`,
`apps/viewer/src/pages/Qualification.jsx`.
**Files modified:** `server/src/services/points.js` (shared table inputs, explicit bonus winner for
simulations), `server/src/routes/misc.js`, `server/src/middleware/http.js`, `server/src/config/env.js`,
`server/src/validation.js`, `server/.env.example`, viewer (`main.jsx`, `Points.jsx`, `Centre.jsx`),
docs (API, ARCHITECTURE).
**New environment variable:** `RATE_LIMIT_WHATIF_PER_MIN` (optional, default 30).
**Database changes:** none.

**Tests:** `npm test` → **242 / 242** (10 new: brute-force oracle on 300 leagues, status cases incl.
must-win with a bonus point and NRR-only, honest give-up on a huge search, combination shares;
API picture, what-if final table without touching real data, NRR from simulated scores, score
validation, open-fixture and duplicate checks). `npm run test:e2e` → **13 / 13**. Builds OK. Page
checked at 1280 px and 390 px on a 13-team table with 8 matches left.

---

## Phase 8 — Historical MPL records ✅ (2026-11-03)

Built as a provision (no historical files exist yet); fields come from the shared performance list,
so the model can still be adjusted before production.

**Features**
- **Models**: per-season player rows and team rows keyed by permanent identity + season + category,
  each tagged with its import; an import log for audit and undo.
- **Admin → History** import: file → editable **column mapping** (guessed) → **season mapping**
  (season column, or year + "year X is season Y") → **category mapping** (fixed, or a column's
  values mapped) → validation with row numbers → **preview** (new / replace / skip per row) →
  **identity choices** (new by default; same-name suggestions shown, linked only by the admin;
  explicit bulk "link every single suggestion") → confirm (hash covers rows, choices and the
  replace flag) → summary → import list with **undo** (replaced rows restored).
- **Safety**: seasons scored in this system are refused; duplicate person/season rows in a file are
  errors (a key column distinguishes namesakes); one person cannot be linked twice for a season;
  rows already imported are kept unless "replace" is ticked; one champion per season; results ≤
  matches.
- **No double counting** (`resolveCareer`): each season counted once from the most detailed source
  (scored > imported row > auction previous-year); the auction "before" total used only when no
  covered season has its own row (or replaced when rows cover all its seasons); careers never mix
  categories. Profile notes explain exactly what was counted.
- **Player profile**: "Season by season" table (imported / earlier scored seasons, MVP marks) next
  to the existing blocks; career notes.
- **Team profile**: separately labelled "History" — seasons, titles, finals, matches, wins, win %,
  best finish, highest score, season-by-season finishes.
- **Tournament Centre → Previous seasons** (lazy-loaded): champion, runner-up, top run scorer, top
  wicket taker, MVP and highest total per season; all-time (earlier seasons) most runs / wickets /
  matches / titles, shared places for level values; per category only.
- **Auction import**: warns when the "previous season" label is a year other than the year before
  the current season (found during the visual check: an old export would otherwise file last
  season's figures under the wrong season).

**Files created:** `server/src/models/Historical.js`, `server/src/services/{history,historyImport}.js`,
`server/test/unit/history.test.js`, `server/test/integration/history.test.js`,
`apps/admin/src/pages/History.jsx`, `data/history-players.example.csv`,
`data/history-teams.example.csv`.
**Files modified:** models index, `services/stats.js` (career via resolver, season table),
routes (`people.js`, `misc.js`, `catalog.js`), `validation.js`, admin `main.jsx`, viewer
(`Players.jsx`, `Teams.jsx`, `Centre.jsx`), `data/auction.example.json`, tests (people), docs
(README, API, ARCHITECTURE, MIGRATIONS, IMPORT_FORMATS).
**Database changes:** M3 — three new collections, nothing existing changed.

**Tests:** `npm test` → **259 / 259** (17 new: career resolution in every overlap case, column
guessing, overs, year → season, scored-season refusal, namesakes, category values, team checks;
API: suggestions never applied, hash must match the choices, linked profile with seasons and a
career counted once, skip vs replace, undo restoring replaced rows, team history, category history
and isolation, year-label warning). `npm run test:e2e` → **13 / 13**. Builds OK. The whole import
was driven through the real admin UI and the resulting profile, team and Centre pages checked.

---

## Phase 9 — Branding and loader ✅ (2026-11-03)

- **Official MPL logo** (supplied 2026-11-03) stored unchanged in `branding/`; `branding/generate.py`
  crops the margin, makes the outside transparent and resizes — never redraws. Web copies are WebP
  (loader logo 40 KB instead of 361 KB as PNG).
- **Central config** `packages/shared/src/branding.js` (`BRAND`: name, short name, season 21, year
  2026, logo paths, launch colour, studio credit), read by every app and by the viewer's
  `index.html` through a small Vite plugin.
- **Everywhere**: favicon (viewer, admin, LED), PWA icons + manifest ("MPL 21"), Apple touch icon,
  **Android launcher icons (square, round, adaptive) and splash** (74 files regenerated with
  `capacitor-assets`), viewer header, admin header and login, LED idle screen and scoreboard header.
- **Launch loader** (web, PWA, Android after the native splash): dark background, logo with a
  subtle fade-in and glow, name, season, progress bar, "by iKRA Studios"; ≥ 2 s and until the
  tournament information is available (≤ 10 s); never on navigation; reduced-motion aware.
  The first version used a one-line inline script, which the E2E test caught being blocked by the
  server's Content-Security-Policy — replaced by `performance.now()`; the CSP was not weakened.
- **iKRA Studios** credit (text until the studio logo is supplied): loader, viewer footer, admin
  login, LED idle screen.
- Existing colour palette kept (teal header); the name shown in production comes from Settings /
  `TOURNAMENT_NAME` — set it to "Maheshwari Premier League".
- Old generic icons removed; service-worker shell cache bumped so installed PWAs refresh.

**Tests:** `npm test` → 259 / 259; `npm run test:e2e` → 13 / 13 (no CSP errors); builds OK.
Loader, landing, header/footer, admin login, LED idle and Android icon/splash checked visually.
**Docs:** `docs/BRANDING.md`.

---

## Phase checklist

- [x] Phase 1 — Audit and architecture
- [x] Phase 2 — Tournament foundation (season, categories, scoping, DB-level active lock, navigation)
- [x] Phase 3 — Player and team data (auction import v2, historical aggregates, identity mapping)
- [x] Phase 4 — Scoring and realtime reliability (engine review, new tests)
- [x] Phase 5 — Statistics and profiles (caps with ties, MVP, player/team profiles)
- [x] Phase 6 — Tournament Centre
- [x] Phase 7 — Qualification predictor and what-if
- [x] Phase 8 — Historical MPL records
- [x] Phase 9 — Branding and loader
- [ ] Phase 10 — Optimisation, security review, deployment checklist
