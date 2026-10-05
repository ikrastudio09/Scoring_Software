import { Link } from 'react-router';
import { Card, StatusBadge, TeamLogo } from './ui.jsx';
import { fmtDateTime, STAGE_LABEL } from '../lib/format.js';

function TeamRow({ team, innings, winner, chasing }) {
  const score = innings?.find((i) => i.team === team?.id);
  const won = winner && team?.id && winner === team.id;
  return (
    <div className="flex items-center gap-3">
      <TeamLogo team={team} size="h-8 w-8 text-[10px]" />
      <span className={`min-w-0 flex-1 truncate text-sm ${won ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{team?.name || 'TBD'}</span>
      {score && (
        <span className={`tnum text-sm ${won ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
          {score.runs}/{score.wickets}
          <span className="ml-1 text-xs font-normal text-slate-500">({score.overs})</span>
          {chasing === team?.id && <span className="ml-1 text-red-600">*</span>}
        </span>
      )}
    </div>
  );
}

/** Compact card used on lists. `live` (optional) overrides the stored summary with realtime data. */
export default function MatchCard({ match, live }) {
  const innings = live
    ? live.innings.map((i) => ({ team: i.battingTeam, runs: i.runs, wickets: i.wickets, overs: i.overs }))
    : match.summary?.innings;
  const resultText = live?.result?.text || match.result?.text;
  const chasing = live?.current?.status === 'IN_PROGRESS' ? live.current.battingTeam : null;
  const status = live?.match?.status || match.status;
  let footer = resultText;
  if (!footer && live?.current?.target && live.current.status === 'IN_PROGRESS') {
    footer = `Need ${live.current.runsNeeded} from ${live.current.ballsRemaining} balls`;
  } else if (!footer && status === 'INNINGS_BREAK') footer = 'Innings break';
  else if (!footer && match.status === 'READY' && live?.match?.toss) {
    const t = live.teams[live.match.toss.winner];
    footer = t ? `${t.name} won the toss and chose to ${live.match.toss.decision}` : null;
  }

  return (
    <Link to={`/matches/${match.id}`} className="block">
      <Card className="p-4 transition hover:ring-brand/40">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">
            Match {match.number}
            {match.stage !== 'league' && <> · <span className="font-semibold text-slate-700">{STAGE_LABEL[match.stage]}</span></>}
            {' · '}{fmtDateTime(match.scheduledAt)}
          </span>
          <StatusBadge status={status} />
        </div>
        <div className="space-y-2">
          <TeamRow team={match.teamA} innings={innings} winner={match.result?.winner || live?.result?.winner} chasing={chasing} />
          <TeamRow team={match.teamB} innings={innings} winner={match.result?.winner || live?.result?.winner} chasing={chasing} />
        </div>
        {(footer || match.venue) && (
          <p className={`mt-3 text-xs ${resultText ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>{footer || match.venue}</p>
        )}
      </Card>
    </Link>
  );
}
