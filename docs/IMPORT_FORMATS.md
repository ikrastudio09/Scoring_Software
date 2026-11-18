# Import formats

## Auction / registration snapshot (Admin → Import)

One import per **category**: pick Men's / Ladies / Kids in the console header first. Files may be
JSON (`{ players: [...], teams: [...] }`, an array, or mongoexport lines), CSV or XLSX (a sheet
named like "players" / "teams"). Column names are matched case- and punctuation-insensitively, so
`Player Name`, `playerName` and `player_name` are the same column.

### Players

| Column | Required | Notes |
|---|---|---|
| `playerID` | yes | positive whole number, unique **within this category of this season**. It is not a person across seasons. |
| `playerName` | yes | display only — never used to match people |
| `playerStatus` | | `sold` / `unsold` (default: sold if on a team). Unsold players are not imported. |
| `soldPoints`, `playerPool` | | numbers ≥ 0 |
| `playerType`, `playingStyle` | | `playingStyle`: list or `;`/`,`-separated of `Right Arm Batting`, `Right Arm Balling`, `Left Arm Batting`, `Left Arm Balling` (also "Bowling") |
| `playerPhoto` | | `{url}` object or a URL column; must be http(s) |
| `teamID`, `teamName` | | single-sheet exports: the player's team |
| `Age` | | whole number 5–100; stored for **administrators only**, never public. Anything else is a warning and is not stored. |
| `previousTeam`, `previousTeamPoints` (`Previous Points`) | | `NULL` / `N/A` mean none |
| `playerPhone` (`Mobile No.`) | | **never stored**; only counted in the preview |
| `previousPerformance` (`Previous Statistics`) | | text, see below |
| `previousYearPerformance`, `overallPreviousPerformance` | | structured alternative, see below; takes precedence over the text |

### Teams

`teamID`, `teamName` and either `teamPlayers: [{playerID, playerName, soldPoints, playerPool}]`
(one document per team) or one row per member (`teamID, teamName, playerID`).

### Previous performance — text form

As in the MPL player list:

```
ASD:- S-10, M-63, R-380, W-57, C-18, MOM-10 | 2024:- M-10, R-41, W-4, C-3
```

* Segments are separated by `|`; each is `LABEL:- CODE-value, …`.
* `ASD` (also `All…`, `Overall…`, `Career…`) = **all seasons, including the previous one**.
  A dated label (`2024`) = **the previous season**.
* Codes: `S` seasons, `M` matches, `I` innings, `R` runs, `B`/`BF` balls faced, `NO` not outs,
  `4S`, `6S`, `W` wickets, `BB` balls bowled, `RC` runs conceded, `C` catches, `RO` run outs,
  `ST` stumpings, `MOM`/`POM`/`POTM` player-of-the-match awards. Unknown codes are reported and ignored.
* `N/A`, `NULL`, blank = no previous record.

Stored as two separate records:

| Record | Derivation |
|---|---|
| **Previous year** | the dated segment (seasons = 1) |
| **Overall previous** (all seasons before the previous one) | `ASD − previous year`, field by field |

Rules (nothing is guessed):
* A field that would become negative is not stored (`HISTORY_INCONSISTENT`).
* A field present in ASD but not in the previous year cannot be separated and is not stored
  (`HISTORY_NOT_SEPARABLE`).
* If ASD's `MOM` equals the previous year's matches it is treated as the known shifted column
  in the export and not stored (`HISTORY_MOM_UNRELIABLE`).
* Players whose only season was the previous one have no overall-previous record; players who
  missed the previous season have no previous-year record.
* Unreadable text is a warning; the player is imported without history and can be corrected in
  **Admin → Players → Previous performance**.

### Previous performance — structured form

```json
"previousYearPerformance":    { "matches": 10, "runs": 41, "ballsFaced": 30, "wickets": 4, "overs": "3.2", "catches": 3, "sr": 136.7 },
"overallPreviousPerformance": { "seasons": 9, "matches": 53, "runs": 339, "wickets": 53, "catches": 15 }
```

Counting fields: see `PERFORMANCE_FIELDS` in `packages/shared/src/performance.js` (aliases:
`inns`, `balls`, `notout`, `conceded`, `mom`/`potm`). `overs` (6-ball) is converted exactly to balls
bowled. Rates (`battingAvg`/`avg`, `strikeRate`/`sr`, `economy`/`econ`, `bowlingAvg`) are kept
**as supplied** and only shown when totals cannot produce them — they are never averaged.

### Changing the statistics kept

Edit `PERFORMANCE_FIELDS` (and `STAT_CODES` for new short codes) in
`packages/shared/src/performance.js`. The database schema, validation, the parser, the admin
editor and the import preview all read that list.

### Re-imports

Re-importing the same file changes nothing. History corrected by an admin is kept
(`HISTORY_MANUAL_KEPT`). A player without a playerID already on the same team with the same
name is offered as "same person?" in the preview and only linked when the admin ticks it.

## Historical MPL records (Admin → History)

One row per **player per season** or per **team per season**, for seasons before the ones scored
in this system (rows for a scored season are refused: they would count twice). Examples:
`data/history-players.example.csv`, `data/history-teams.example.csv` (fictional names).

Workflow: choose the file → check the **column mapping** (guessed from the headers, editable) →
**season mapping** (a `Season` column, or a `Year` column plus "year 2025 is season 20") →
**category** (one for the whole file, or a category column whose values you map) → **preview**
(errors per row, duplicates, rows already imported) → **identity choices** (each person / team
starts as new; same-name identities are offered as suggestions, linked only when you choose them;
"Link every single same-name suggestion" is an explicit bulk action) → **confirm** (must match the
preview exactly) → summary. Every import can be **undone**; rows it replaced are restored.

Player season columns (any order, any case): `Player`/`Name`, optional `Key` (tells apart two people
with the same name), `Season` or `Year`, `Category`, `Team`, `playerID`, and any of the statistics
in `PERFORMANCE_FIELDS` — `M`, `Inns`, `Runs`, `BF`, `NO`, `4s`, `6s`, `Wkts`, `BB` or `Overs`, `RC`,
`Ct`, `RO`, `St`, `MOM` — plus `Avg`, `SR`, `Econ` (kept as supplied) and `MVP` (yes / 1).
Blank = not known (never 0).

Team season columns: `Team`, optional `Key`, `Season` or `Year`, `Category`, `P`, `W`, `L`, `T`,
`NR`, `Pts`, `NRR`, `Highest`, `Position`, `Champion` (yes), `Finalist` / `Runner-up` (yes).
Checks: results never exceed matches; one champion per season and category.

Rows already imported for the same identity, season and category are **kept** unless
"Replace rows already imported" is ticked for that preview.

## Tournament data file (`npm run import -w server -- <file.json> [--category ladies]`)

See `data/tournament.example.json`: `tournament`, `teams` (with `players`) and `fixtures`
(team short names). Imported into one category; idempotent.
