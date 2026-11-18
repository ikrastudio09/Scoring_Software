# Architecture

One deployment = one league season (MPL Season 21) with three independent **categories**: Men's,
Ladies and Kids. One Node.js process, one MongoDB database, three static web apps (admin, viewer,
LED) and one Android wrapper around the viewer. **At most one match is live at a time across all
categories** (enforced in the database, see "One active match").

## Categories

`categories` holds one document per (season, key) — `mens`, `ladies`, `kids` — created at startup
for `tournament.currentSeason`. Teams, players, matches and `playermatchstats` carry `category`
(an id that already implies the season); every tournament query, cache and leaderboard is scoped
by it, so category figures can never be combined. Uniqueness is per category: team names,
auction `teamID` / `playerID` and match numbers (`Match 1` exists in every category).

Settings resolve as **season default** (the tournament document) overlaid with the **category's
overrides** (`services/categories.js categoryConfig`): rules, points, MVP weights, leaderboard
thresholds, qualification slots. Matches still freeze their rules at creation.

Public endpoints take `?category=mens|ladies|kids` (or an id). A request without one gets Men's,
so clients built before categories (installed Android apps) keep working. The viewer routes are
`/:category/...`; old links without a category redirect to the last category the user chose.

```
                       ┌──────────────────────────── Node.js process ─────────────────────────────┐
 Admin (React) ──REST──►  Express API ──► ScoringService ──► Engine (pure)                         │
     ▲                 │       │              │   ▲  per-match mutex + in-memory state cache        │
     │ socket (JWT)    │       │              ▼   │                                                 │
 LED (React) ◄─socket──┤  Socket.IO  ◄── Broadcaster ◄─┘    StatsService / PointsService (async)    │
 Viewer web / Android ◄┤  rooms: match:<id> led:<id> viewers:<id> tournament                        │
     │ REST (read-only)└──────────────────────────────┬───────────────────────────────────────────┘
     └────────────────────────────────────────────────▼
                                                   MongoDB
```

## Technology (pinned for Node 20 LTS)

| Concern | Choice | Why |
|---|---|---|
| API | Express 5 | Simple, well known |
| DB | MongoDB 8 + Mongoose 8 | Requested; document fits match state |
| Realtime | Socket.IO 4 | Rooms, auto reconnect, fallbacks |
| Validation | zod | One schema per command, shared error shape |
| Logging | pino (JSON) | Fast structured logs |
| Auth | bcryptjs + JWT | No native build step; stateless |
| Frontend | React 19, Vite 6, Tailwind 4, React Router 7 | Requested; Vite 6 is the last line supporting Node 20.18 |
| Mobile | Capacitor 7 (Android) | Reuses the viewer build unchanged |
| Tests | Vitest 3, supertest, socket.io-client, real local mongod | No mocks for the DB layer |

Deliberately **not** used: microservices, Redis, queues, GraphQL, Kubernetes, multi-tenancy.
500 concurrent sockets and ~1 write/second is a tiny load for one Node process.

## Repository layout

```
packages/shared   constants (event names, statuses, dismissal types), overs/format helpers
packages/client   browser helpers: API client, live-match socket hook with version guard
server/src
  engine/         PURE cricket engine: applyEvent(state, event) → state, replay(), result, scorecard
  services/       scoring (command pipeline), matches, stats, points, tournament, audit
  routes/         REST routers (thin; validation + call service)
  realtime/       Socket.IO setup, rooms, broadcaster
  models/         Mongoose schemas
  middleware/     auth, errors, rate limits, request logging
server/scripts    seed, import tournament JSON, rebuild stats, backup/restore
apps/admin        scorer console + tournament management (served at /admin)
apps/viewer       public site (served at /), also the Capacitor Android app
apps/led          LED display (served at /led)
load/             load + latency benchmarks
infrastructure/   nginx, pm2, systemd, backup scripts
data/             tournament data files (clone point for a new tournament)
```

## Source of truth vs derived data

| Data | Kind | Notes |
|---|---|---|
| `matchevents` (one document per scoring command) | **Source of truth** | Append-only. Undo marks an event `undone` and appends an `UNDO` event. Never deleted. |
| `matches` setup (teams, toss, XIs, rules snapshot) | **Source of truth** | Rules are copied into the match at creation so later tournament edits never change a played match. |
| `matches.state` / `matches.summary` / `matches.result` | Derived cache | Rebuilt by replaying events. Written after each event. |
| `playermatchstats` | Derived | Built on result confirmation; rebuildable from all events (`npm run stats:rebuild`). Includes the per-match facts the MVP formula needs (`context`). |
| `commentaryedits` | Source of truth (display only) | Scorer rewording of one ball, keyed (match, seq). Never read by scoring. |
| `players` / `teams` snapshot | Source of truth (after import) | Imported once from the auction system; `playerID` / `teamID` are the canonical keys. No phone numbers or ages are stored. |
| Points table, leaderboards | Derived | Computed from confirmed matches + `playermatchstats`, cached in memory, invalidated on confirmation. |

## Scoring write path (the hot path)

```
POST /api/matches/:id/deliveries {clientEventId, expectedVersion, ...}
 1. auth (JWT, role scorer|admin) + zod validation
 2. per-match mutex (serialises commands for one match in-process)
 3. idempotency: clientEventId already stored? → return current state, duplicate=true
 4. expectedVersion !== state.version → 409 STALE_STATE (+ current state)
 5. engine.applyEvent(clone(state), event)   — pure, throws ScoringError on illegal input
 6. insert MatchEvent {seq = version+1} with journaled write   ← commit point
    unique indexes (matchId,seq) and (matchId,clientEventId) make double-commits impossible
 7. update match snapshot (state, status, summary) — failure is logged, not fatal; replay fixes it
 8. respond to scorer with the live view
 9. broadcast (fire-and-forget): ONE envelope per event, emitted once to the LED and viewer
   rooms together (every ball), plus the scorer view to the admin room
10. on match completion confirmation → stats + points recompute in background
```

MongoDB runs standalone (no transactions needed): the single event insert is the atomic commit.
Everything after step 6 is derived and recoverable. Statistics and broadcasting can fail
without affecting scoring (priority order from the spec §55).

## Identities and historical aggregates

The auction `playerID` is unique only inside one category of one season and changes every
season, so it identifies a **season record** (`players`), not a person. Each season record points
to a permanent **`playeridentities`** document (teams: `teamidentities`). New records always get a
new identity; an admin links records that are the same person in **Admin → Players** (names are
offered as suggestions only; phone numbers are never used). An identity emptied by a link is
marked `mergedInto`, never deleted.

A season record carries two separate historical aggregates from the auction snapshot:
`history.previousYear` (the preceding season) and `history.overallPrevious` (all seasons before
it), each built from one shared field list (`packages/shared/src/performance.js`). Current-season
statistics are always calculated from scored matches and are never stored in these blocks.
Career = overall previous + previous year + current season, summing only the fields every part
has (`combinePerformances`), with rates derived from totals — never averaged.

## Historical records and careers

Imported past seasons live in `historicalplayerseasons` / `historicalteamseasons`, keyed by the
permanent identity, season and category, each row tagged with its import (undo = delete those rows,
restore the rows it replaced). Careers never count a season twice (`services/history.js`
`resolveCareer`): for each season the most detailed source wins — scored in this system >
imported season row > the auction's previous-year figure; the auction's all-earlier-seasons total
is used only when no season it covers has its own row (or replaced when rows cover all of its
seasons; when rows cover only some, the total is used and those rows are not added). A career
stays within one category. Seasons scored in this system cannot be imported.

## Qualification predictor

`engine/qualification.js` (pure). Statements of certainty are proven over every combination of
the remaining counted fixtures, on points; level finishes are always reported as decided by NRR /
tie-breakers, never as certain. A team's own matches are fixed at its best (win with bonus) or
worst (defeat by a bonus-point win) — monotone, so only the other matches are searched, by an exact
depth-first search with bounds and early exit. A node budget caps the work; when it is exceeded the
team is "in contention" and nothing is claimed. Verified against brute force on 300 random leagues.
Typical cost for 16 teams × 4 matches: under 30 ms. What-if results are applied in memory only.

## One active match

`services/active.js`. One rule for the whole tournament: a live Men's match blocks Ladies and Kids
matches too. In play = `LIVE | INNINGS_BREAK | SECOND_INNINGS`; a match whose last ball
has been bowled but whose result is not confirmed is still the *active* match (viewers keep
seeing it; points and stats are not final). Rules, enforced in the scoring pipeline before the
event is committed:

- A command that would move a match **into** play (the first ball, or an undo that reopens a
  finished match) runs under a process-wide activation lock and is rejected with
  `409 ANOTHER_MATCH_ACTIVE` if any other match is in play (checked in memory and in MongoDB).
- Starting a match additionally requires every finished match to be confirmed.
- The command then **claims the database lock** (`activelocks`, one document `_id: "global"`) with a
  conditional atomic update — it succeeds only if the lock is free or already this match's — and
  only then commits the event. Two claims can never both succeed, even from two processes. If the
  commit fails, a fresh claim is released again.
- The lock is released when the result is confirmed, or when an undo takes the match back to
  "ready". At startup (and `POST /api/admin/active-lock/repair`) it is re-derived from the match
  documents, so a crash never leaves a stale lock.
- Ordinary deliveries never take either lock (no cost on the hot path).
- `GET /api/live` answers "what is live now?" with the state + recent commentary.

The in-process lock gives fast, clear errors; the database lock is the guarantee. The deployment
stays one process anyway (Socket.IO without an adapter and the per-match mutex require it).

## Commentary

`engine/commentary.js` is a pure function of the match state: the same events always produce the
same text (template variety is chosen from the ball's sequence number). No AI, no network.
Optional `shot` on a delivery (drive, pull, …) only changes wording. Scorer edits are stored in
`commentaryedits` and replace the sentence; the factual score line is never editable. A failure
while generating commentary drops the text from the broadcast and never the update itself.

## MVP / impact score

`engine/impact.js`. `impactContext(state)` stores per-player match facts (match scoring rate,
top-order wickets, won chase / defence) with the derived statistics; `scoreImpact(row, weights)`
applies the weights at read time, so changing weights (Settings → MVP impact weights) needs no
rebuild. Formula and defaults are documented in the file header. Auction value is never an input;
"value for money" (impact per 100k auction points) is a separate list.

## Auction import

`services/auctionImport.js`: `validateAuctionImport` (pure) → `planAuctionImport` (compares with
the database: create / update / link-by-name / unchanged; refuses moving a player who has already
played) → `applyAuctionImport`. The admin previews, then confirms; the commit re-validates and
must match the previewed data hash. Files are parsed in the admin app (JSON, CSV, XLSX); the
server validates every value.

## Engine model

`replay(setup, events)` folds events into a `MatchState`. Commands (event types):

| Type | Payload | When |
|---|---|---|
| `START_INNINGS` | strikerId, nonStrikerId, bowlerId | match ready / innings break |
| `DELIVERY` | extra (none, wide, noball, bye, legbye), runs, boundary, noBallRunsType, wicket{type,batterId,fielderId} | live |
| `SET_BOWLER` | bowlerId | start of over, or mid-over replacement (injury) |
| `NEW_BATTER` | batterId | after wicket / retirement |
| `RETIRE` | batterId, kind (retired_hurt, retired_out) | between balls |
| `SWAP_STRIKE` | — | scorer correction |
| `END_INNINGS` | reason | manual (e.g. time/forfeit) |
| `CONCLUDE` | resultType (no_result, walkover), winnerTeamId | abandonment |
| `UNDO` | — | service-level: reverts last effective event |

Rules implemented centrally (see `server/src/engine/rules.js`):
- Wide = `wideRuns` penalty + runs run, all wides, all charged to the bowler, not a ball faced.
- No-ball = `noBallRuns` penalty (charged to bowler) + runs off the bat (batter + bowler) **or**
  byes/leg-byes (extras, not bowler). Counts as a ball faced. Next ball is a free hit (configurable),
  free hit carries over wides/no-balls.
- Byes / leg-byes: legal ball, ball faced, not charged to bowler.
- Strike changes on odd runs completed, at end of over, and new batter comes in at the
  dismissed batter's end (caught: striker's end per Law 18.11, 2017+).
- Dismissal legality: wides allow stumped/run out/hit wicket/obstructing; no-balls and free
  hits allow run out/obstructing/hit the ball twice only — on a free hit **even when it is called a
  wide** (no stumping off a free-hit wide). Bowler credited for bowled, caught, c&b, lbw, stumped,
  hit wicket. A catch needs the fielder and a stumping the wicketkeeper (or a substitute), so
  fielding statistics are complete.
- Over completes after `ballsPerOver` legal balls; bowler of the previous over cannot bowl the
  next; `maxOversPerBowler` with part-overs counting as a full over (ICC playing condition).
- Innings ends on overs, all out (`XI size − 1` wickets), target reached, or manual end.
- Result: win by runs / wickets (with balls remaining), tie, no result, walkover.
- Ties: a league tie stays a tie; outside the league stage a Super Over decides the winner.
- Not supported (documented): DLS, last-man-stands, penalty runs (5).

## Realtime contract

Every socket message is an envelope:

```json
{ "type": "BALL_RECORDED", "matchId": "...", "version": 57, "eventId": "...",
  "ts": 1730000000000, "effects": ["BALL","FOUR"], "live": { ...LiveView } }
```

Clients keep the highest `version` per match and drop anything older (no regressions).
On (re)connect the client emits `subscribe {matchId, channel}`; the server joins the room and
immediately sends `MATCH_STATE_UPDATED` with the current snapshot — recovery is one message,
never a replay of events.

| Event | LED | Viewers | Admin |
|---|---|---|---|
| `BALL_RECORDED`, `OVER_COMPLETED`, `WICKET`, `INNINGS_COMPLETED`, `MATCH_STARTED`, `MATCH_COMPLETED`, `EVENT_UNDONE`, `MATCH_STATE_UPDATED` | ✔ every event | ✔ every event | ✔ |
| `COMMENTARY_UPDATED` | – | ✔ | ✔ |
| `POINTS_TABLE_UPDATED`, `STATISTICS_UPDATED`, `MATCH_STATUS_CHANGED` | – | ✔ (tournament room) | ✔ |

Full payload docs: [REALTIME_EVENTS.md](REALTIME_EVENTS.md).

## Match lifecycle

```
SCHEDULED ─setup(toss,XI)→ READY ─start→ LIVE ─innings end→ INNINGS_BREAK ─start→ SECOND_INNINGS ─→ COMPLETED ─confirm→ (final)
SCHEDULED ⇄ POSTPONED ; SCHEDULED|READY → CANCELLED | ABANDONED ; LIVE|BREAK|SECOND → COMPLETED(no result)
```
COMPLETED + not confirmed: undo still allowed. Confirmed: locked; only an admin `reopen`
(audited) unlocks it, and confirmation recomputes points/stats.

## Deployment

Single VM (2 vCPU / 2 GB is ample): nginx (TLS, WebSocket upgrade) → Node (pm2, auto restart)
→ MongoDB (local, `mongodump` cron backups). Express serves the three built apps. See
[DEPLOYMENT.md](DEPLOYMENT.md).
