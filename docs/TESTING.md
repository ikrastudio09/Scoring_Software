# Testing and measured performance

All numbers below were produced by the commands shown, on the development machine
(Windows 11 laptop, Node 20.18, MongoDB 8.2 local, everything — server, database and load
generator — on the same machine). Production hardware separates these and will do better.

## How to run

```bash
npm test                       # server: engine unit + invariant + integration + realtime + tournament (needs local mongod)
npm run test:engine            # engine only (no database)
npm run build && npm run test:e2e   # browser E2E with the system Chrome (Playwright)
npm run load -- --viewers 500 --ballMs 2000 --balls 60 --httpConcurrency 10 --httpRps 25
node load/engine-bench.js      # engine micro-benchmark
```

Integration tests create and drop throwaway databases (`cricket_test_*`) on the local mongod
(`MONGODB_TEST_URI` overrides the server). E2E uses `cricket_e2e`; the load test `cricket_load`.

## Suites (157 server tests + 13 E2E, all passing)

| Suite | File | What it proves |
|---|---|---|
| Engine rules (79) | `server/test/engine/engine.test.js` | runs 0–6 incl. 5 (overthrows); wides (incl. multiple and boundary wides), no-balls (+bat runs, +byes), byes, leg byes, configurable penalties; maidens; free hit (carries over wides, only run out allowed, can be disabled); every dismissal type incl. stumped/run out off a wide, run out of either batter with runs, substitute fielder, last-ball wicket end-swap; retired hurt/out; strike rotation (odd/even/boundary/end of over/wide/no-ball); bowler required, consecutive overs, max overs, part-over counts toward limit, mid-over change, correction before first ball; innings end on overs (8 and 10 overs), all out, target, manual; chase result by wickets/runs, tie, no result, walkover; views and scorecard; stats extraction; replay = incremental state |
| Invariants (2) | `server/test/engine/invariants.test.js` | **400 random matches** (~30 000 accepted + thousands of deliberately illegal commands), invariants checked after every event: score = Σ deliveries = bat runs + extras; bowler runs = total − byes − leg byes; legal balls ≤ quota, 6 per completed over; wickets ≤ XI−1 and = dismissed batters = FOW; no dismissed batter at the crease; bowler limit and no consecutive overs; partnerships sum to the total; target reached ⇒ innings and match over; completed match rejects input; rejected commands leave state untouched; **undo ≡ replay of the remaining events** |
| Points/NRR (8) | `server/test/engine/points.test.js` | configurable points, ordering, exact NRR with partial overs, all-out full quota (and its off switch), no-result and walkover exclusions; configurable tie-breakers incl. head-to-head |
| API integration (20) | `server/test/integration/scoring.test.js` | auth (401/403, role limits, no field injection); full match through the API to confirmed result, points table, NRR, leaderboards, player profile; locked after confirmation, admin reopen; **duplicates: same clientEventId twice → 1 ball; 20 parallel retries → 1 ball; double tap on same version → 1 ball + 409; double-tapped undo → 1 undo**; undo restores state, audit log marks undone events; domain error codes, no stack traces; setup lock; **recovery: cache dropped, a second server process on the same DB, stale match document repaired from the log**; lifecycle transitions, abandonment, no result |
| Realtime (6) | `server/test/integration/realtime.test.js` | LED **and viewers** receive every version 1…n in order, each delivery with a compact `ball` summary + commentary (envelope < 6 KB); envelope contract; reconnect → exactly one snapshot, no replay; admin channel needs a token; room isolation; tournament room status/points/stats events; **scoring keeps working when the socket layer throws** |
| Commentary (7) | `server/test/engine/commentary.test.js` | text for dot, 1–3, 4, 6, wide, no-ball, bye, leg bye; every dismissal with bowler/fielder names; cricket ball numbering for extras; score line, chase equation, end-of-over summary with CRR/projection; fifty milestone, free hit, shot wording, end of innings; deterministic; scorer edits replace the sentence only |
| Impact / MVP (4) | `server/test/engine/impact.test.js` | the published formula exactly; tempo/economy relative to the match; weights configurable; auction value is not an input; context (top-order wickets, winning chase) from the engine state |
| Auction import (22) | `server/test/unit/auctionImport.test.js` | real auction export → playerID→teamID mapping; flat spreadsheet rows; single-sheet exports; rejects duplicate playerID/teamID, missing playerID/teamID, sold without team, team referencing an unknown player, duplicate player in a team, player in two teams, invalid status, invalid/non-numeric value, unsold player in a team, missing names, duplicate team names; phone/age never in the snapshot; mismatch warnings |
| Live operations (8) | `server/test/integration/live-ops.test.js` | **second match cannot start while one is live** (and not before the previous result is confirmed); reopened old match cannot come back into play; **two simultaneous starts → exactly one wins**; `GET /api/live` for a viewer joining mid-over + every following ball; commentary paging, edit (auth, 404, broadcast, survives cache drop, never changes the score); match MVP top 5 = POTM suggestion, tournament MVP, value-for-money, team/player profiles, configurable weights; import preview → hash-checked commit, nothing private stored or served, idempotent re-import, invalid import refused with nothing written, linking existing teams/players, player who has played cannot move |
| Tournament (1) | `server/test/integration/tournament.test.js` | 81-fixture dataset imported; **all 78 league matches played ball-by-ball (8- and 10-over) — 10 432 commands, 4.1 ms/command incl. journaled DB write**; points table and NRR equal an independent recomputation; stats totals equal a replay of the event log; full rebuild reproduces identical leaderboards |
| E2E (13) | `tests/e2e/*.spec.js` | real Chrome: login, toss + XIs, start innings, scoring by click and keyboard, wide/no-ball/free hit, wicket modal → new batter, over end → bowler picker with disabled previous bowler, undo, **refresh recovers exact state**, **network loss: command held, retried with same id, recorded exactly once**, LED live updates and LED network-drop recovery, viewer per-over policy on a mobile viewport, all public pages render without errors or horizontal overflow, admin routes require login, **Android bundle served cross-origin loads data, receives realtime pushes and recovers after going offline** |

Bugs found and fixed by these tests during development include: a scorecard field collision that
crashed the scorecard screen (E2E), duplicate LED fan-out on status changes (realtime test),
silently dropped rapid key presses (E2E → now surfaced to the scorer), viewers missing updates
when a socket survives a network blip (now resubscribe on `online`/foreground).

## Load test results (`load/run-load.js`)

Real server process (NODE_ENV=production), **one live match** (the server refuses a second),
500 viewer sockets + 1 LED socket, the scorer using the HTTP API, concurrent public REST traffic
(including `/live`, `/commentary`, `/stats/mvp`), then all 500 viewers dropped and reconnected at once.
Measured 2026-10-05.

### Realistic profile — `--viewers 500 --ballMs 2000 --balls 60 --httpConcurrency 10 --httpRps 25`

| Metric | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Scoring request round-trip (scorer) | 34.1 ms | 41.1 ms | 50.3 ms | 50.3 ms |
| Server-side command processing | 12.6 ms | 14.7 ms | 21.7 ms | 21.7 ms |
| Journaled event write (MongoDB) | 10.8 ms | 12.5 ms | 16.4 ms | 16.4 ms |
| Scorer send → LED receives | 16.0 ms | 20.1 ms | 25.6 ms | 25.6 ms |
| Scorer send → viewer receives (30 000 deliveries) | 23.4 ms | 33.7 ms | 39.1 ms | 49.3 ms |
| Public GET requests (3 060) | 7.7 ms | 17.8 ms | 22.3 ms | 38.3 ms |

**Every one of the 500 viewers received all 60 updates** (min = expected = 60), LED 60/60.
Delivery envelope 2.2 KB. Errors: 0 scoring, 0 HTTP, 0 5xx, 0 socket errors. Server: **7 % of one
CPU core, 121 MB RSS**, event-loop p99 2.7 ms (one 195 ms max, outside the scoring window).
Reconnect storm: **500/500 recovered in 0.49 s**. Post-run integrity check: 0 matches needing repair.

### Stress profile — `--matches 2 --ballMs 250 --balls 120 --httpConcurrency 50` (unthrottled)

The second match's start was **rejected (`ANOTHER_MATCH_ACTIVE`)**, so only one match was scored
(the 250 viewers subscribed to the rejected match correctly received nothing). Live match:
120 commands at ~3/s with 50 clients hammering public endpoints back-to-back (**≈2 000 requests/s**,
~80× realistic): LED 120/120, viewers p50 52 ms / p95 67 ms / max 130 ms; scoring round-trip p50
68 ms / p95 87 ms; public GET p50 27 ms / p95 39 ms; 0 HTTP errors, 0 5xx; 215 MB RSS; 155 % CPU
(one core saturated by the request flood); reconnect storm 500/500 in 0.48 s.

Browser measurement (E2E, includes Playwright automation overhead): scorer click → LED repaint
**≈ 62 ms**, → viewer repaint **≈ 82 ms**.

### Engine micro-benchmark (`load/engine-bench.js`)
End-of-match state (143 events, 27 KB): clone 0.53 ms, full replay 0.37 ms — so replay-based
undo and restart recovery are effectively free.

## Known limitations of the test environment
- The Android APK/AAB were **built and signature-verified** (debug 5.2 MB, release 4.0 MB,
  targetSdk 35) but **not run on a physical device or emulator** here (no emulator image /
  hardware virtualization available). The app's runtime path — the Android build of the bundle,
  cross-origin API + Socket.IO, offline recovery — is covered by the E2E test in a mobile Chrome
  viewport. Install the debug APK on a phone pointed at a staging server before the tournament.
- Load generator, server and MongoDB shared one laptop; production numbers will be better.
- Internet-scale latency (mobile networks, TLS) is not part of these measurements; expect the
  scorer round-trip to add the network RTT to the venue (typically 20–80 ms on 4G).
