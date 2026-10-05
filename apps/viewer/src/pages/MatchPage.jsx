import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useApi, useLiveMatch } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import LivePanel from '../components/LivePanel.jsx';
import Scorecard, { OversTable } from '../components/Scorecard.jsx';
import { Card, ErrorState, PlayerLink, Spinner, StatusBadge, Tabs, TeamLogo } from '../components/ui.jsx';
import { fmtDateTime, STAGE_LABEL } from '../lib/format.js';

export default function MatchPage() {
  const { id } = useParams();
  const [tab, setTab] = useState('live');
  const { data, error, reload } = useApi(api, `/matches/${id}`, [id]);
  const { live: view, version, lastEnvelope } = useLiveMatch({ api, live, matchId: id, channel: 'viewer' });
  const sc = useApi(api, tab === 'scorecard' || tab === 'overs' ? `/matches/${id}/scorecard` : null, [id, tab]);

  // Keep the scorecard in step with the live version (updates arrive per over / wicket).
  useEffect(() => { if (version && (tab === 'scorecard' || tab === 'overs')) sc.reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Refresh match info (result, player of the match) when the status changes.
  useEffect(() => { if (lastEnvelope?.type === 'MATCH_COMPLETED' || lastEnvelope?.type === 'MATCH_STATE_UPDATED') reload(); }, [lastEnvelope?.type, lastEnvelope?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const m = data.match;
  const status = view?.match?.status || m.status;
  const result = view?.result?.text || m.result?.text;

  return (
    <div>
      <Card className="mb-4 p-4">
        <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
          <span>Match {m.number}{m.stage !== 'league' && ` · ${STAGE_LABEL[m.stage]}`} · {fmtDateTime(m.scheduledAt)}</span>
          <StatusBadge status={status} />
        </div>
        <div className="flex items-center justify-between gap-2">
          {[m.teamA, m.teamB].map((t, i) => {
            const inn = view?.innings.find((x) => x.battingTeam === t?.id) || m.summary?.innings?.find((x) => x.team === t?.id);
            return (
              <div key={t?.id || i} className={`flex min-w-0 flex-1 items-center gap-2 ${i ? 'flex-row-reverse text-right' : ''}`}>
                <TeamLogo team={t} size="h-11 w-11 text-xs" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t?.name || 'TBD'}</p>
                  {inn && <p className="tnum text-lg font-bold">{inn.runs}/{inn.wickets} <span className="text-xs font-normal text-slate-500">({inn.overs})</span></p>}
                </div>
              </div>
            );
          })}
        </div>
        {result && <p className="mt-3 text-center text-sm font-semibold text-emerald-700">{result}</p>}
        {m.result?.playerOfMatch?.name && (
          <p className="mt-1 text-center text-xs text-slate-600">Player of the match: <PlayerLink id={m.result.playerOfMatch.id} className="font-semibold">{m.result.playerOfMatch.name}</PlayerLink></p>
        )}
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'live', label: 'Live' }, { value: 'scorecard', label: 'Scorecard' }, { value: 'overs', label: 'Overs' }, { value: 'info', label: 'Info' }]} />
      <div className="mt-4">
        {tab === 'live' && (view ? <LivePanel live={view} flashKey={lastEnvelope?.version} /> : <Spinner />)}
        {tab === 'scorecard' && (sc.data ? <Scorecard scorecard={sc.data.scorecard} /> : <Spinner />)}
        {tab === 'overs' && (sc.data ? <OversTable scorecard={sc.data.scorecard} /> : <Spinner />)}
        {tab === 'info' && (
          <Card className="divide-y divide-slate-100 text-sm">
            {[
              ['Venue', m.venue || 'TBC'],
              ['Date', fmtDateTime(m.scheduledAt)],
              ['Format', `${m.rules.oversPerInnings} overs per side · max ${m.rules.maxOversPerBowler} overs per bowler`],
              ['Toss', m.toss ? `${[m.teamA, m.teamB].find((t) => t?.id === m.toss.winner)?.name} chose to ${m.toss.decision}` : 'Not yet'],
              ['Stage', STAGE_LABEL[m.stage]],
            ].map(([k, v]) => <div key={k} className="flex gap-4 px-4 py-2.5"><span className="w-20 shrink-0 text-slate-500">{k}</span><span>{v}</span></div>)}
            {['teamA', 'teamB'].map((side) => m.playingXI[side]?.length > 0 && (
              <div key={side} className="px-4 py-2.5">
                <p className="mb-1 text-slate-500">{m[side]?.name} XI</p>
                <p className="text-slate-700">{m.playingXI[side].map((p) => p.name).join(', ')}</p>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
