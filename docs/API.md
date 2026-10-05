# REST API

Base path `/api`. JSON in and out. Errors always look like:

```json
{ "error": { "code": "BOWLER_LIMIT_REACHED", "message": "Bowler not allowed: Reached the limit of 2 overs", "details": {} } }
```

Auth: `Authorization: Bearer <JWT>` from `POST /api/auth/login`. Roles: `scorer` (score, set up
matches, confirm results) and `admin` (everything). 🔓 = public.

## Auth
| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | 🔓 | `{username, password}` → `{token, user}`; rate limited |
| GET | `/auth/me` | any | current user |
| GET/POST | `/auth/users` | admin | list / create `{username, password(≥10), role, name}` |

## Tournament, teams, players
| Method | Path | Role |
|---|---|---|
| GET | `/tournament` | 🔓 |
| PUT | `/tournament` | admin — partial update (branding, `rules`, `points`) |
| GET | `/teams`, `/teams/:id` (squad + record) | 🔓 |
| POST / PUT / DELETE | `/teams`, `/teams/:id` | admin |
| GET | `/players?team=`, `/players/:id` (career + match log) | 🔓 |
| POST / PUT / DELETE | `/players`, `/players/:id` | admin |

## Matches
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/matches?status=LIVE,COMPLETED&stage=&team=` | 🔓 | list |
| GET | `/matches/:id` | 🔓 | detail incl. XIs |
| GET | `/matches/:id/live` | 🔓 | LiveView (see REALTIME_EVENTS.md) |
| GET | `/matches/:id/scorecard` | 🔓 | full scorecard, FOW, partnerships, over-by-over |
| GET | `/matches/:id/scorer` | scorer | ScorerView |
| GET | `/matches/:id/events` | scorer | audit log of every scoring command |
| GET | `/matches/:id/player-of-match-suggestion` | scorer | |
| POST | `/matches` | admin | create fixture (rules default from tournament) |
| PUT | `/matches/:id` | admin | teams/rules only before scoring starts |
| DELETE | `/matches/:id` | admin | only without scoring events |
| POST | `/matches/:id/setup` | scorer | `{toss:{winner,decision}, playingXI:{teamA:[ids], teamB:[ids]}}` |
| POST | `/matches/:id/status` | admin | `{status: SCHEDULED\|POSTPONED\|CANCELLED\|ABANDONED, note}` (not after scoring starts) |
| POST | `/matches/:id/confirm-result` | scorer | `{playerOfMatch}` → points & stats update |
| POST | `/matches/:id/reopen` | admin | `{reason}` → unlocks a confirmed match for corrections |

## Scoring commands (scorer)

Every command body includes:
- `clientEventId` — unique per intended action (UUID). Re-sending the same id returns
  `duplicate: true` and records nothing.
- `expectedVersion` — the `version` the scorer is looking at. If anything else was recorded in the
  meantime the server answers `409 STALE_STATE` with the current view in `error.details.view`.

Response: `{ version, duplicate, effects, view: ScorerView }`.

| Path | Body (besides the two fields above) |
|---|---|
| `POST /matches/:id/innings/start` | `{strikerId, nonStrikerId, bowlerId}` |
| `POST /matches/:id/deliveries` | `{runs 0–7, extra?: wide\|noball\|bye\|legbye, boundary?, noBallRunsType?: bat\|bye\|legbye, wicket?: {type, batterId?, fielderId?, substituteFielder?}}` |
| `POST /matches/:id/bowler` | `{bowlerId, midOver?}` |
| `POST /matches/:id/batter` | `{batterId}` |
| `POST /matches/:id/retire` | `{batterId, kind: retired_hurt\|retired_out}` |
| `POST /matches/:id/swap-strike` | `{}` |
| `POST /matches/:id/innings/end` | `{reason?}` |
| `POST /matches/:id/conclude` | `{resultType: no_result\|abandoned\|walkover, winnerTeamId?}` |
| `POST /matches/:id/undo` | `{}` |

`runs` = runs completed by the batters (or the boundary), excluding the automatic wide/no-ball
penalty. Examples: dot `{runs:0}` · four `{runs:4, boundary:true}` · 2 wides run `{runs:1, extra:'wide'}` ·
no-ball hit for six `{runs:6, extra:'noball', boundary:true}` · run out of the non-striker after 1
`{runs:1, wicket:{type:'run_out', batterId, fielderId}}`.

Domain error codes: `INVALID_PLAYER INVALID_BOWLER BOWLER_LIMIT_REACHED CONSECUTIVE_OVERS
BOWLER_REQUIRED BATTER_REQUIRED INVALID_WICKET INVALID_DELIVERY INVALID_STRIKE_STATE
INNINGS_NOT_IN_PROGRESS MATCH_NOT_STARTED MATCH_COMPLETED MATCH_LOCKED INVALID_TRANSITION
NOTHING_TO_UNDO STALE_STATE` (+ `VALIDATION_ERROR UNAUTHORIZED FORBIDDEN NOT_FOUND RATE_LIMITED`).

## Public aggregates
| Method | Path | Notes |
|---|---|---|
| GET | `/home` | tournament, in-play matches with live views, upcoming, recent results (2 s cache) |
| GET | `/points-table` | groups → rows `{position, team, played, won, lost, tied, noResult, points, nrr, form}` |
| GET | `/stats/leaderboards` | most runs/wickets, highest scores, best bowling, SR, economy, average, 4s, 6s, catches, dots, POTM |

## Operations (admin)
| Method | Path |
|---|---|
| GET | `/health` 🔓 — 200 `ok` / 503 `degraded` with DB ping |
| GET | `/admin/metrics` — latency percentiles, sockets, memory, CPU, event loop |
| GET | `/admin/audit?entityId=&limit=` |
| POST | `/admin/stats/rebuild` — recompute all statistics from events |
| POST | `/admin/reconcile` — resync match documents from the event log |
