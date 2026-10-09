# Cricket Scoring System

A complete scoring system for **one cricket tournament per deployment**: a fast scorer console,
an LED scoreboard updated after every ball, a public website and Android app, and automatic
points table, NRR and statistics.

```
apps/admin    Scorer console + tournament management      → https://<domain>/admin/
apps/led      LED scoreboard (updates every ball)          → https://<domain>/led/
apps/viewer   Public website + Android app (Capacitor)     → https://<domain>/
server        Express API, Socket.IO, cricket engine, MongoDB
packages      shared constants/formatting, client API + realtime library
```

## Quick start (development)

```bash
npm install                                     # Node 20.18+, MongoDB running locally
cp server/.env.example server/.env              # set NODE_ENV=development and ADMIN_PASSWORD
npm run seed -- --reset --simulate 20 --live    # sample 81-match tournament, 20 results, 1 live match
npm run dev                                     # server on :4000
npm run dev:admin  /  dev:viewer  /  dev:led    # Vite dev servers (5174 / 5173 / 5175)
```

Or build once and let the server host everything on :4000: `npm run build && npm start`.

## Before the tournament: import the auction data

**Admin → Import**: choose the players and teams files exported from the auction system (JSON,
CSV or XLSX — see `data/auction.example.json`). The server validates IDs, player→team mapping
(by `playerID` → `teamID`, never by name), statuses and auction values, shows a preview, and
writes nothing until you confirm. Phone numbers and ages are never imported. Re-importing the
same file changes nothing. The auction system is not needed during matches.

## Scoring a match (match day)

Only **one match can be live at a time**. Confirm the previous result before starting the next.

1. **Admin → Matches → Toss & XIs**: record the toss and tick each playing XI.
2. **Start innings**: openers and opening bowler.
3. **Score**: tap runs (`0`–`7` keys). For extras tap `Wd` / `Nb` / `B` / `LB` (or `W N B L`) then
   the runs. `WICKET` (`X`) opens the dismissal dialog. The console then asks for the new batter
   or the next bowler (unavailable bowlers are greyed out with the reason).
4. **Undo** (`U` or Ctrl+Z) reverts the last action exactly; the original stays in the event log.
   An optional **Shot** chip (drive, pull, …) adds colour to the generated commentary; the
   **Commentary** tab (or *Edit* on the last ball) lets you reword any ball.
5. Innings and match end automatically (overs, all out, target). **Confirm result** (with Player
   of the Match) to update the points table and statistics.
6. Rain? **More… → Conclude match → No result**. Injury mid-over? **More… → Change bowler**.

If the network drops, the console shows **"Not yet confirmed"**, keeps the action and retries it
with the same id until the server confirms it — it is recorded exactly once. Closing or crashing
the laptop loses nothing: reopen the console and it resumes from the server's state.

Viewers (website, installable PWA, Android app) and the LED receive **every ball** with local,
deterministic commentary. `GET /api/live` returns the current match for anyone joining mid-over.

Put the LED page (`/led/` follows the live match automatically, or `/led/?match=<id>`) on the
screen in full-screen mode (F11).

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | architecture, data model, engine rules, write path, lifecycle |
| [docs/API.md](docs/API.md) | REST endpoints and scoring commands |
| [docs/REALTIME_EVENTS.md](docs/REALTIME_EVENTS.md) | Socket.IO contract and payloads |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | production setup, HTTPS, logs, backups, recovery, cloning |
| [docs/ANDROID.md](docs/ANDROID.md) | APK / AAB builds, signing, deep links, Play Store |
| [docs/TESTING.md](docs/TESTING.md) | test suites and measured performance |

## Commands

| Command | Purpose |
|---|---|
| `npm test` | server unit + integration + realtime + tournament tests (local mongod) |
| `npm run test:e2e` | browser end-to-end tests (after `npm run build`) |
| `npm run load -- …` | load / latency test (see docs/TESTING.md) |
| `npm run seed -- --reset --simulate N --live` | sample data |
| `npm run import -w server -- <file.json>` | load a real tournament (see `data/tournament.example.json`) |
| `npm run create-user -w server -- <name> <admin\|scorer>` | add a scorer |
| `npm run verify:matches -w server [-- --repair]` | integrity check of every match against its event log |
| `npm run stats:rebuild -w server` | recompute all statistics from events |
| `npm run backup -w server` | mongodump backup (see DEPLOYMENT.md) |

## Rules supported

Configurable per tournament (and frozen per match at creation): overs per innings, balls per over,
max overs per bowler (part overs count, no consecutive overs), players per side, wide/no-ball
penalty runs, free hit. Points for win/tie/no result/loss, stages counted, NRR all-out rule.

Not in V1: super over (ties are recorded as ties), DLS/revised targets, last-man-stands, 5-run
penalty awards, changing a playing XI after scoring has started.
