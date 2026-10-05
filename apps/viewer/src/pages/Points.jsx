import { useEffect } from 'react';
import { Link } from 'react-router';
import { formatNrr } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Card, ErrorState, Spinner, TeamLogo } from '../components/ui.jsx';

const FORM = { W: 'bg-emerald-500', L: 'bg-red-500', T: 'bg-slate-400', N: 'bg-slate-300' };

export default function Points() {
  const { data, error, reload } = useApi(api, '/points-table');
  useEffect(() => live.onTournament((e) => { if (e.type === 'POINTS_TABLE_UPDATED') reload(); }), [reload]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const r = data.rules;
  return (
    <div>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Points table</h1>
      {data.groups.map((g) => (
        <Card key={g.group || 'all'} className="mb-4 overflow-hidden">
          {data.groups.length > 1 && <p className="bg-slate-50 px-4 py-2 text-sm font-semibold">Group {g.group}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="w-8 py-2 pl-4 text-left font-medium">#</th>
                  <th className="text-left font-medium">Team</th>
                  {['P', 'W', 'L', 'T', 'NR'].map((h, i) => <th key={h} className={`w-8 text-center font-medium ${i > 2 ? 'hidden sm:table-cell' : ''}`}>{h}</th>)}
                  <th className="w-12 text-center font-semibold text-slate-700">Pts</th>
                  <th className="w-16 pr-4 text-right font-medium sm:pr-0">NRR</th>
                  <th className="hidden w-28 pr-4 text-right font-medium sm:table-cell">Form</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((row) => (
                  <tr key={row.team.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pl-4 text-slate-500 tnum">{row.position}</td>
                    <td>
                      <Link to={`/teams/${row.team.id}`} className="flex items-center gap-2 font-medium hover:text-brand">
                        <span className="hidden sm:inline-flex"><TeamLogo team={row.team} size="h-7 w-7 text-[9px]" /></span>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full sm:hidden" style={{ background: row.team.color }} />
                        <span className="hidden sm:inline">{row.team.name}</span>
                        <span className="sm:hidden">{row.team.shortName}</span>
                      </Link>
                    </td>
                    {[row.played, row.won, row.lost, row.tied, row.noResult].map((v, i) => <td key={i} className={`text-center tnum ${i > 2 ? 'hidden sm:table-cell' : ''}`}>{v}</td>)}
                    <td className="text-center font-bold tnum">{row.points}</td>
                    <td className={`pr-4 text-right tnum sm:pr-0 ${row.nrr > 0 ? 'text-emerald-700' : row.nrr < 0 ? 'text-red-600' : ''}`}>{formatNrr(row.nrr)}</td>
                    <td className="hidden pr-4 sm:table-cell">
                      <div className="flex justify-end gap-1">{row.form.map((f, i) => <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white ${FORM[f]}`}>{f}</span>)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      <p className="text-xs text-slate-500">
        Win {r.win} · Tie {r.tie} · No result {r.noResult} · Loss {r.loss} points. Sorted by points, then net run rate.
        {r.nrrAllOutUsesFullQuota && ' A side bowled out is charged its full quota of overs for NRR.'}
      </p>
    </div>
  );
}
