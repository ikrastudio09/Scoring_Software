# Realtime event contract

Transport: Socket.IO 4 on the same origin as the API (`/socket.io/`). Clients never write over
the socket; all changes go through the REST API. Constants live in `packages/shared/src/constants.js`.

## Connecting

```js
io(URL, { auth: { client: 'viewer' | 'led' | 'admin', token: '<JWT, admin only>' } })
```

## Client → server

| Message | Payload | Ack |
|---|---|---|
| `cricket:subscribe` | `{ matchId, channel: 'viewer' \| 'led' \| 'admin' }` | `{ ok: true, version }` or `{ ok: false, error }` |
| `cricket:subscribe` | `{ channel: 'tournament' }` | `{ ok: true }` |
| `cricket:unsubscribe` | `{ matchId, channel }` or `{ channel: 'tournament' }` | – |

`admin` requires a valid JWT in the handshake. A socket may hold at most 12 subscriptions.
**Every successful match subscribe is answered immediately with a `MATCH_STATE_UPDATED`
snapshot.** Clients must resubscribe after every reconnect (the `@cricket/client` library does).
Missed messages are never replayed; the snapshot replaces them.

## Server → client: `cricket:event`

Match envelope:

```jsonc
{
  "type": "BALL_RECORDED",            // see table
  "matchId": "6ac2…",
  "version": 57,                      // = sequence number of the latest event; strictly increasing
  "eventId": "6ac2…:57",
  "ts": 1791124690892,                // server time (ms)
  "effects": ["BALL", "FOUR"],        // [] for snapshots
  "live": { /* LiveView (viewer, led) or ScorerView (admin) */ }
}
```

| `type` | Sent when | LED | Viewers | Admin |
|---|---|---|---|---|
| `BALL_RECORDED` | a delivery without wicket/over end | ✔ | – | ✔ |
| `OVER_COMPLETED` | 6th legal ball of an over | ✔ | ✔ | ✔ |
| `WICKET` | dismissal or retired out | ✔ | ✔ | ✔ |
| `INNINGS_COMPLETED` | overs/all out/target/manual end | ✔ | ✔ | ✔ |
| `MATCH_STARTED` | first innings started | ✔ | ✔ | ✔ |
| `MATCH_COMPLETED` | result decided (or concluded) | ✔ | ✔ | ✔ |
| `EVENT_UNDONE` | undo | ✔ | ✔ | ✔ |
| `MATCH_STATE_UPDATED` | subscribe snapshot; bowler/batter change; setup, confirmation, reopen, status change | ✔ | ✔ (except bowler/batter changes) | ✔ |

Effects: `BALL FOUR SIX EXTRA FREE_HIT WICKET OVER_COMPLETED INNINGS_STARTED INNINGS_COMPLETED
MATCH_STARTED MATCH_COMPLETED BOWLER_CHANGED BATTER_CHANGED STRIKE_CHANGED UNDO`.

Tournament room envelopes (no `live`):

| `type` | Payload |
|---|---|
| `MATCH_STATUS_CHANGED` | `{ matchId, version, status, summary, result }` |
| `POINTS_TABLE_UPDATED` | `{ matchId }` — refetch `GET /api/points-table` |
| `STATISTICS_UPDATED` | `{ matchId }` — refetch `GET /api/stats/leaderboards` |

## Ordering rule (no regressions)

A client keeps the highest `version` per match and applies an envelope only if
`version > current`, or `version === current && type === 'MATCH_STATE_UPDATED'` (a snapshot of a
non-scoring change such as result confirmation is re-sent at the same version). Implemented in
`isNewer()` in `packages/client/src/live.js`.

## LiveView (abridged)

```jsonc
{
  "matchId": "…", "version": 57, "state": "IN_PROGRESS",   // NOT_STARTED | IN_PROGRESS | INNINGS_BREAK | COMPLETED
  "rules": { "oversPerInnings": 10, "ballsPerOver": 6, "maxOversPerBowler": 2 },
  "teams": { "<teamId>": { "name", "shortName", "color", "logoUrl" } },
  "innings": [{ "number", "battingTeam", "runs", "wickets", "overs": "9.4", "target", "status" }],
  "current": {
    "inningsNumber", "battingTeam", "bowlingTeam", "runs", "wickets", "overs", "legalBalls", "maxOvers",
    "extras", "crr", "target", "runsNeeded", "ballsRemaining", "rrr", "freeHit",
    "striker": { "id", "name", "runs", "balls", "fours", "sixes", "sr" }, "nonStriker": { … },
    "bowler": { "id", "name", "overs", "runs", "wickets", "maidens", "econ" },
    "thisOver": { "over", "runs", "wickets", "balls": ["1","4","Wd","W"], "completed" },
    "recentOvers": [ … ], "partnership": { "runs", "balls" }, "lastWicket": { "name", "runs", "balls", "howOut", "score" }
  },
  "needs": { "batter": false, "bowler": false, "startInnings": false },
  "lastEvent": { "type", "seq", "effects", "label" },
  "result": { "type": "win|tie|no_result|abandoned|walkover", "winner", "marginRuns|marginWickets", "text" } ,
  "match": { "number", "status", "stage", "venue", "scheduledAt", "teamA", "teamB", "toss", "resultConfirmed", "playerOfMatch" }
}
```

ScorerView (admin) adds `scorer` (XIs, yet-to-bat, bowler availability with reasons) and `undo`
(the event an undo would revert). Typical size: 2–4 KB.
