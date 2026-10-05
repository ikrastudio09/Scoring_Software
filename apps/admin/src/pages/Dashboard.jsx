import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Button, Card, ErrorBox, PageHeader, Spinner, StatusBadge, fmtDateTime } from '../components/ui.jsx';

const IN_PLAY = ['LIVE', 'INNINGS_BREAK', 'SECOND_INNINGS'];

function Row({ m }) {
  const score = (m.summary?.innings || []).map((i) => `${i.runs}/${i.wickets} (${i.overs})`).join(' · ');
  const needsSetup = m.status === 'SCHEDULED' && m.teamA?.id && m.teamB?.id;
  const action = IN_PLAY.includes(m.status) || m.status === 'READY' ? { to: `/matches/${m.id}/score`, label: m.status === 'READY' ? 'Start scoring' : 'Resume scoring', primary: true }
    : needsSetup ? { to: `/matches/${m.id}/setup`, label: 'Toss & XIs' }
      : m.status === 'COMPLETED' && !m.result?.confirmed ? { to: `/matches/${m.id}/score`, label: 'Confirm result', primary: true }
        : { to: `/matches/${m.id}/score`, label: 'Open' };
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-0">
      <span className="w-10 text-xs text-slate-500 tnum">#{m.number}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{m.teamA?.name || 'TBD'} <span className="font-normal text-slate-400">v</span> {m.teamB?.name || 'TBD'}</p>
        <p className="text-xs text-slate-500">{fmtDateTime(m.scheduledAt)}{m.venue ? ` · ${m.venue}` : ''}{score ? ` · ${score}` : ''}{m.result?.text ? ` · ${m.result.text}` : ''}</p>
      </div>
      <StatusBadge status={m.status} />
      {m.status === 'COMPLETED' && !m.result?.confirmed && <span className="text-xs font-semibold text-amber-700">unconfirmed</span>}
      <Link to={action.to}><Button variant={action.primary ? 'primary' : 'secondary'} size="px-3 py-1.5 text-sm">{action.label}</Button></Link>
    </div>
  );
}

export default function Dashboard() {
  const { data, error, reload } = useApi(api, '/matches');
  useEffect(() => live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') reload(); }), [reload]);
  const groups = useMemo(() => {
    const all = data?.matches || [];
    return [
      ['In play', all.filter((m) => IN_PLAY.includes(m.status))],
      ['Needs result confirmation', all.filter((m) => m.status === 'COMPLETED' && !m.result?.confirmed)],
      ['Ready (toss done)', all.filter((m) => m.status === 'READY')],
      ['Upcoming', all.filter((m) => m.status === 'SCHEDULED' || m.status === 'POSTPONED').slice(0, 12)],
      ['Recently completed', all.filter((m) => (m.status === 'COMPLETED' && m.result?.confirmed) || m.status === 'ABANDONED').sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt)).slice(0, 8)],
    ];
  }, [data]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title="Matches"><Link to="/fixtures"><Button variant="secondary">All fixtures</Button></Link></PageHeader>
      {groups.map(([title, list]) => list.length > 0 && (
        <section key={title} className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          <Card>{list.map((m) => <Row key={m.id} m={m} />)}</Card>
        </section>
      ))}
      {!data.matches.length && <Card className="p-6 text-center text-sm text-slate-500">No fixtures yet. Create teams, then add fixtures.</Card>}
    </div>
  );
}
