# Testing and measured performance

All numbers below were produced by the commands shown, on the development machine
(Windows 11 laptop, Node 20.18, MongoDB 8.2 local, everything — server, database and load
generator — on the same machine). Production hardware separates these and will do better.

## How to run

```bash
npm test                       # server: engine unit + invariant + integration + realtime + tournament (needs local mongod)
npm run test:engine            # engine only (no database)
npm run build && npm run test:e2e   # browser E2E with the system Chrome (Playwright)
npm run load -- --viewers 500 --matches 4 --ballMs 2000 --balls 40 --httpConcurrency 10 --httpRps 25
node load/engine-bench.js      # engine micro-benchmark
```

Integration tests create and drop throwaway databases (`cricket_test_*`) on the local mongod
(`MONGODB_TEST_URI` overrides the server). E2E uses `cricket_e2e`; the load test `cricket_load`.

## Suites (114 server tests + 13 E2E, all passing)

| Suite | File | What it proves |
|---|---|---|
| Engine rules (79) | `server/test/engine/engine.test.js` | runs 0–6 incl. 5 (overthrows); wides (incl. multiple and boundary wides), no-balls (+bat runs, +byes), byes, leg byes, configurable penalties; maidens; free hit (carries over wides, only run out allowed, can be disabled); every dismissal type incl. stumped/run out off a wide, run out of either batter with runs, substitute fielder, last-ball wicket end-swap; retired hurt/out; strike rotation (odd/even/boundary/end of over/wide/no-ball); bowler required, consecutive overs, max overs, part-over counts toward limit, mid-over change, correction before first ball; innings end on overs (8 and 10 overs), all out, target, manual; chase result by wickets/runs, tie, no result, walkover; views and scorecard; stats extraction; replay = incremental state |
| Invariants (2) | `server/test/engine/invariants.test.js` | **400 random matches** (~30 000 accepted + thousands of deliberately illegal commands), invariants checked after every event: score = Σ deliveries = bat runs + extras; bowler runs = total − byes − leg byes; legal balls ≤ quota, 6 per completed over; wickets ≤ XI−1 and = dismissed batters = FOW; no dismissed batter at the crease; bowler limit and no consecutive overs; partnerships sum to the total; target reached ⇒ innings and match over; completed match rejects input; rejected commands leave state untouched; **undo ≡ replay of the remaining events** |
| Points/NRR (6) | `server/test/engine/points.test.js` | configurable points, ordering, exact NRR with partial overs, all-out full quota (and its off switch), no-result and walkover exclusions |
| API integration (20) | `server/test/integration/scoring.test.js` | auth (401/403, role limits, no field injection); full match through the API to confirmed result, points table, NRR, leaderboards, player profile; locked after confirmation, admin reopen; **duplicates: same clientEventId twice → 1 ball; 20 parallel retries → 1 ball; double tap on same version → 1 ball + 409; double-tapped undo → 1 undo**; undo restores state, audit log marks undone events; domain error codes, no stack traces; setup lock; **recovery: cache dropped, a second server process on the same DB, stale match document repaired from the log**; lifecycle transitions, abandonment, no result |
| Realtime (6) | `server/test/integration/realtime.test.js` | LED receives every version 1…n in order; viewers only MATCH_STARTED/WICKET/OVER_COMPLETED/undo; envelope contract; reconnect → exactly one snapshot, no replay; admin channel needs a token; room isolation; tournament room status/points/stats events; **scoring keeps working when the socket layer throws** |
| Tournament (1) | `server/test/integration/tournament.test.js` | 81-fixture dataset imported; **all 78 league matches played ball-by-ball (8- and 10-over) — 10 432 commands, 4.1 ms/command incl. journaled DB write**; points table and NRR equal an independent recomputation; stats totals equal a replay of the event log; full rebuild reproduces identical leaderboards |
| E2E (13) | `tests/e2e/*.spec.js` | real Chrome: login, toss + XIs, start innings, scoring by click and keyboard, wide/no-ball/free hit, wicket modal → new batter, over end → bowler picker with disabled previous bowler, undo, **refresh recovers exact state**, **network loss: command held, retried with same id, recorded exactly once**, LED live updates and LED network-drop recovery, viewer per-over policy on a mobile viewport, all public pages render without errors or horizontal overflow, admin routes require login, **Android bundle served cross-origin loads data, receives realtime pushes and recovers after going offline** |

Bugs found and fixed by these tests during development include: a scorecard field collision that
crashed the scorecard screen (E2E), duplicate LED fan-out on status changes (realtime test),
silently dropped rapid key presses (E2E → now surfaced to the scorer), viewers missing updates
when a socket survives a network blip (now resubscribe on `online`/foreground).

## Load test results (`load/run-load.js`)

Real server process, 500 viewer sockets + 4 LED sockets across **4 simultaneous live matches**,
scorers using the HTTP API, concurrent public REST traffic, then all 500 viewers dropped and
reconnected at once.

### Realistic profile — `--ballMs 2000 --httpRps 25` (still ~15× faster than real cricket)

| Metric | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Scoring request round-trip (scorer) | 34.7 ms | 61.3 ms | 96.5 ms | 98.1 ms |
| Server-side command processing | 15.5 ms | 31.5 ms | 36.1 ms | 38.2 ms |
| Journaled event write (MongoDB) | 10.2 ms | 14.6 ms | 16.1 ms | 16.4 ms |
| Scorer send → LED receives | 24.4 ms | 50.0 ms | 69.4 ms | 77.9 ms |
| Scorer send → viewer receives (3 875 deliveries) | 35.3 ms | 75.3 ms | 87.7 ms | 90.1 ms |
| Public GET requests | 10.3 ms | 34.8 ms | 50.9 ms | 122 ms |
| Event-loop lag | 0.42 ms | — | 6.2 ms | — |

LED updates received: **160 / 160**. Errors: **0** scoring, **0** HTTP, **0** 5xx, 0 socket errors.
Server: **13 % of one CPU core, 126 MB RSS**. Reconnect storm: **500/500 recovered in 0.98 s**.
Post-run integrity check: 10 matches checked, 0 needing repair.

### Stress profile — `--ballMs 250 --httpConcurrency 50` (unthrottled)

4 scorers at ~12 commands/s combined plus 50 clients hammering public endpoints back-to-back
(**1 451 requests/s**, ~50× realistic viewer traffic): 480/480 LED updates, 0 errors, 0 5xx;
scoring round-trip p50 80 ms / p95 117 ms; LED p50 61 ms / p95 85 ms; public GET p50 32 ms /
p95 53 ms; 234 MB RSS; reconnect storm 500/500 in 0.71 s. The server stays correct and
responsive while saturated.

### Engine micro-benchmark (`load/engine-bench.js`)
End-of-match state (143 events, 27 KB): clone 0.53 ms, full replay 0.37 ms — so replay-based
undo and restart recovery are effectively free.

Browser measurement (E2E, includes Playwright automation overhead): scorer click → LED repaint
**≈ 70 ms**.

## Known limitations of the test environment
- The Android APK/AAB were **built and signature-verified** (debug 5.2 MB, release 4.0 MB,
  targetSdk 35) but **not run on a physical device or emulator** here (no emulator image /
  hardware virtualization available). The app's runtime path — the Android build of the bundle,
  cross-origin API + Socket.IO, offline recovery — is covered by the E2E test in a mobile Chrome
  viewport. Install the debug APK on a phone pointed at a staging server before the tournament.
- Load generator, server and MongoDB shared one laptop; production numbers will be better.
- Internet-scale latency (mobile networks, TLS) is not part of these measurements; expect the
  scorer round-trip to add the network RTT to the venue (typically 20–80 ms on 4G).
