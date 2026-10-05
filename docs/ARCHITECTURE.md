# Architecture

One deployment = one tournament. One Node.js process, one MongoDB database, three
static web apps (admin, viewer, LED) and one Android wrapper around the viewer.

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
| `playermatchstats` | Derived | Built on result confirmation; rebuildable from all events (`npm run stats:rebuild`). |
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
 9. broadcast (fire-and-forget): LED every event; viewers on over/wicket/innings/match/undo
10. on match completion confirmation → stats + points recompute in background
```

MongoDB runs standalone (no transactions needed): the single event insert is the atomic commit.
Everything after step 6 is derived and recoverable. Statistics and broadcasting can fail
without affecting scoring (priority order from the spec §55).

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
  hits allow run out/obstructing only. Bowler credited for bowled, caught, c&b, lbw, stumped, hit wicket.
- Over completes after `ballsPerOver` legal balls; bowler of the previous over cannot bowl the
  next; `maxOversPerBowler` with part-overs counting as a full over (ICC playing condition).
- Innings ends on overs, all out (`XI size − 1` wickets), target reached, or manual end.
- Result: win by runs / wickets (with balls remaining), tie, no result, walkover.
- Not supported in V1 (documented): super over, DLS, last-man-stands, penalty runs (5).

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
| `BALL_RECORDED` | ✔ every ball | – | ✔ |
| `OVER_COMPLETED`, `WICKET`, `INNINGS_COMPLETED`, `MATCH_STARTED`, `MATCH_COMPLETED`, `EVENT_UNDONE`, `MATCH_STATE_UPDATED` | ✔ | ✔ | ✔ |
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
