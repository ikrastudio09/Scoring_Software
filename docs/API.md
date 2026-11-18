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

## Categories (Men's / Ladies / Kids)

Every tournament list and aggregate is per category. Public endpoints take
`?category=mens|ladies|kids` (or a category id); **without it the Men's category is used**, so
older clients keep working. Teams, players and matches carry `category` (the category id).

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/categories` | 🔓 | `{season, categories:[{id, key, name, shortName, season, order, active}]}` |
| GET | `/categories/:key` | 🔓 | + `overrides` (what the category sets) and `effective` (season defaults + overrides: `rules`, `points`, `impactWeights`, `leaderboards`, `qualification`) |
| PUT | `/categories/:key` | admin | partial: `name, shortName, order, active, rules, points, impactWeights, leaderboards {strikeRateMinBalls, economyMinBalls, averageMinInnings, capMinMatches}, qualification {slots}`; a group set to `null` returns to the season defaults |

## Tournament, teams, players
| Method | Path | Role |
|---|---|---|
| GET | `/tournament` | 🔓 |
| PUT | `/tournament` | admin — partial update (branding, `rules`, `points`) |
| GET | `/teams?category=`, `/teams/:id` (squad + record) | 🔓 |
| POST / PUT / DELETE | `/teams`, `/teams/:id` | admin — POST takes `category` (key or id; default Men's); names are unique per category; the category cannot change later |
| GET | `/players?category=` or `?team=`, `/players/:id` (career + match log + `awards {orangeCap, orangeRank, purpleCap, purpleRank, mvpRank, mvpAwards, playerOfMatch}` + `history {currentSeason, previousYear, overallPrevious, career, seasons, otherCategories}`; each block `{label, totals, rates, supplied}`; `seasons` = earlier seasons with their own records (imported or scored); career adds `partial`, `sources` and `notes` — every season counted once, rates never averaged). `GET /teams/:id` adds `history {summary {seasons, titles, finals, matches, won, winPct, bestFinish, highestScore}, seasons[]}` or null | 🔓 |
| POST / PUT / DELETE | `/players`, `/players/:id` | admin — a player takes the category of their team and cannot move to another category |

## Matches
| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/matches?category=&status=LIVE,COMPLETED&stage=&team=` | 🔓 | list (a `team` filter implies its category) |
| GET | `/matches/:id` | 🔓 | detail incl. XIs |
| GET | `/matches/:id/live` | 🔓 | LiveView (see REALTIME_EVENTS.md) |
| GET | `/matches/:id/scorecard` | 🔓 | full scorecard, FOW, partnerships, over-by-over |
| GET | `/matches/:id/commentary?limit=30&before=<seq>` | 🔓 | ball-by-ball commentary, newest first |
| PUT | `/matches/:id/commentary/:seq` | scorer | `{text}` replaces one ball's sentence; `""` restores the generated text |
| GET | `/matches/:id/mvp` | 🔓 | top 5 by impact with reasons (`final: false` while live) |
| GET | `/matches/:id/scorer` | scorer | ScorerView |
| GET | `/matches/:id/events` | scorer | audit log of every scoring command |
| GET | `/matches/:id/player-of-match-suggestion` | scorer | |
| POST | `/matches` | admin | create fixture `{category, …}`; numbered per category; both teams must be in that category; rules default from the category |
| PUT | `/matches/:id` | admin | teams/rules only before scoring starts |
| DELETE | `/matches/:id` | admin | only without scoring events |
| POST | `/matches/:id/setup` | scorer | `{toss:{winner,decision}, playingXI:{teamA:[ids], teamB:[ids]}}` |
| POST | `/matches/:id/status` | admin | `{status: SCHEDULED\|POSTPONED\|CANCELLED\|ABANDONED, note}` (not after scoring starts) |
| POST | `/matches/:id/confirm-result` | scorer | `{playerOfMatch}` → points & stats update; clears the active match |
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
| `POST /matches/:id/deliveries` | `{runs 0–7, extra?: wide\|noball\|bye\|legbye, boundary?, noBallRunsType?: bat\|bye\|legbye, shot?: drive\|pull\|…, wicket?: {type, batterId?, fielderId?, substituteFielder?}}` (`shot` is optional, commentary only; `fielderId` or `substituteFielder` is required for `caught` and `stumped`) |
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
NOTHING_TO_UNDO STALE_STATE ANOTHER_MATCH_ACTIVE` (another match is live in any category — `details.activeCategory` names it — or a finished one is not confirmed yet) (+ `VALIDATION_ERROR UNAUTHORIZED FORBIDDEN NOT_FOUND RATE_LIMITED`).

## Public aggregates
| Method | Path | Notes |
|---|---|---|
| GET | `/live` | `{live:false}` or `{live:true, inPlay, matchId, category, version, view, commentary}` — the one active match of the whole tournament |
| GET | `/overview` | landing page: tournament, every category with `counts`, `next` fixture and `last` result, and `active` (the live match + its category) (2 s cache) |
| GET | `/home?category=` | the category's dashboard: in-play matches with live views, upcoming, recent results, plus `active` (the global live match, possibly in another category) (2 s cache) |
| GET | `/stats/mvp?category=` | the category's MVP table (impact components, MVP awards) + `valueForMoney` + current weights |
| GET | `/tournament-centre?category=` | one category's `overview {totalMatches, completed, remaining, runs, wickets, fours, sixes, extras, overs, fifties}`, `records` (highest individual score, best bowling, most runs / wickets / fours / sixes / catches, best average / strike rate / economy, most valuable player), `teamRecords` (highest and lowest completed total, highest successful chase, biggest wins by runs and by wickets, most wins / points, best NRR, longest winning streak) and `leaderboards` (Orange / Purple Cap, MVP, batting, bowling, fielding top 5). Every record lists **all** holders when level; Super Overs excluded (5 s cache) |
| GET | `/qualification?category=` | per group: rows `{position, team, points, nrr, remaining, minPoints, maxPoints, status, label, certainty, text, nextMatch, undetermined, combinations?}` + `remaining` fixtures + `rules {slots, win, tie, noResult, bonus, tiebreakers}`. `status`: `QUALIFIED` (league over) · `SECURED` · `ELIMINATED` (certainty `guaranteed`: true in every combination of remaining results) · `NRR_ONLY` / `NRR_DEPENDENT` (`nrr`: only a level finish on points can change it) · `MUST_WIN` · `WIN_AND_DEPEND` · `IN_OWN_HANDS` · `IN_CONTENTION` (`possible`). `undetermined: true` = the search hit its budget, so nothing certain is claimed. `combinations {total, outright, tieBreak}` only when ≤ 50 000 combinations (descriptive, not a forecast) (5 s cache) |
| POST | `/qualification/what-if` | `{category, results: [{matchId, outcome: A\|B\|T\|N, bonus?, score?: {battedFirst: teamA\|teamB, teamA: {runs, wickets, overs}, teamB: {…}}}]}` — open league fixtures only. Returns the same shape with `hypothetical: true`, `simulated`, `nrrExcludes` (simulated wins/ties without a score: they cannot move NRR). Computed in memory, **never stored**. Scores are checked for consistency (winner scores more, overs within the limit, a chase ends at the target, a defeated chaser is all out or used its overs). Rate limited (`RATE_LIMIT_WHATIF_PER_MIN`, default 30) |
| GET | `/history?category=` | earlier seasons of the category from imported records: `seasons[{season, champion, runnerUp, topRunScorer, topWicketTaker, mvp, highestTotal}]`, `allTime {mostRuns, mostWickets, mostMatches, mostCatches, mostTitles}`, `available` (60 s cache, cleared by imports) |
| GET | `/points-table?category=` | groups → rows `{position, team, played, won, lost, tied, noResult, points, nrr, form}`, `qualificationSlots` |
| GET | `/stats/leaderboards?category=` | `orangeCap` / `purpleCap` `{holders:[playerId], rows}` (rows: runs/wickets, matches, innings/overs, average, strike rate, 4s/6s or economy/best), most runs/wickets, highest scores, best bowling, SR, economy, average, 4s, 6s, catches, `mostDismissals` (catches + run outs + stumpings), dots, POTM. Every row has `rank` and `tied`: players level on the ranked value share the rank (1, 1, 3); lists show the top 10 plus anyone tied with 10th. `qualify` = the category's thresholds incl. `capMinMatches` |

## Operations (admin)
| Method | Path |
|---|---|
| GET | `/health` 🔓 — 200 `ok` / 503 `degraded` with DB ping |
| GET | `/admin/metrics` — latency percentiles, sockets, memory, CPU, event loop |
| GET | `/admin/audit?entityId=&limit=` |
| POST | `/admin/stats/rebuild` — recompute all statistics from events |
| POST | `/admin/reconcile` — resync match documents from the event log |
| GET | `/admin/active-lock` — the global one-active-match lock and the active match |
| GET | `/admin/players?category=` — season records with the private `age`, `previousSeason {team, points}` and `history {previousYear, overallPrevious, raw, flags, source, updatedAt, updatedBy}` |
| PUT | `/admin/players/:id/history` — `{previousYear?, overallPrevious?, previousSeason?, reason}`; a block is `{seasons, matches, …, supplied?, meta?}` or `null`; stored as `source: manual` (kept by re-imports), audited with before/after |
| GET | `/admin/identities/players?category=` — each record, its linked records in other categories/seasons, and name-based `suggestions` (never applied) |
| GET | `/admin/identities/players/search?q=`, `/admin/identities/players/:id` — identities with their records (a merged id resolves to the live identity) |
| POST | `/admin/players/:id/identity` — `{identityId}` = same person (409 if that person already has a record in this category), `{identityId: null}` = separate again |
| GET | `/admin/import/history/fields`; POST `/admin/import/history/guess` `{kind, columns}` → suggested `mapping` |
| POST | `/admin/import/history/preview` — `{kind: players\|teams, fileName?, rows, mapping, category? \| categoryValues?, seasonFromYear? {year, season}, choices? {groupKey: 'new'\|identityId}, overwrite?}` → `{ok, hash, errors[{row,message}], warnings, counts {create, replace, skip, newIdentities}, groups[{key, name, choice, suggestions, rows[{row, season, categoryKey, action}]}]}` (writes nothing) |
| POST | `/admin/import/history/commit` — same body + `hash` (must match the preview incl. choices) → `{result: {importId, …counts}}` |
| GET / DELETE | `/admin/import/history`, `/admin/import/history/:id` — list imports; undo one (its rows removed, rows it replaced restored) |
| GET | `/admin/identities/teams?category=`; POST `/admin/teams/:id/identity` `{identityId \| null}` — franchise identity; a linked team's old name becomes an alias |
| POST | `/admin/active-lock/repair` — re-derive the lock from the match documents (also runs at startup) |
| POST | `/admin/import/auction/preview` — `{category, players:[…], teams:[…], links?}` (into that category; `links: {playerID: existingPlayerId}` confirms an offered "same person" candidate; per-player `history` totals and `flags` in the preview; formats in IMPORT_FORMATS.md) → validation report, checks, plan, `hash` (writes nothing) |
| POST | `/admin/import/auction/commit` — same body + `hash` → re-validated and applied (`422 IMPORT_INVALID` with the report if invalid) |

`PUT /tournament` also accepts `points.tiebreakers` (order of `nrr`, `wins`, `headToHead`) and
`impactWeights` (partial MVP weights, `null` = defaults). Public player objects carry `playerID`,
`playerType`, `playingStyle` and `auction {soldPoints, playerPool, status}` — never a phone number.
