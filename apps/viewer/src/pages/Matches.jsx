import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import MatchCard from '../components/MatchCard.jsx';
import { Empty, ErrorState, Spinner, Tabs } from '../components/ui.jsx';
import { dayKey, fmtDate, isLive } from '../lib/format.js';

const TABS = [
  { value: 'fixtures', label: 'Fixtures' },
  { value: 'results', label: 'Results' },
  { value: 'all', label: 'All' },
];

export default function Matches() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'fixtures';
  const { data, error, loading, reload } = useApi(api, '/matches');
  useEffect(() => live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') reload(); }), [reload]);

  const groups = useMemo(() => {
    const all = data?.matches || [];
    let list = all;
    if (tab === 'fixtures') list = all.filter((m) => !['COMPLETED', 'ABANDONED', 'CANCELLED'].includes(m.status));
    if (tab === 'results') list = all.filter((m) => ['COMPLETED', 'ABANDONED', 'CANCELLED'].includes(m.status)).reverse();
    // In-play matches first on the fixtures tab.
    if (tab === 'fixtures') list = [...list.filter((m) => isLive(m.status)), ...list.filter((m) => !isLive(m.status))];
    const out = [];
    for (const m of list) {
      const key = isLive(m.status) && tab === 'fixtures' ? 'live' : dayKey(m.scheduledAt);
      if (out.at(-1)?.key !== key) out.push({ key, label: key === 'live' ? 'Live now' : fmtDate(m.scheduledAt), items: [] });
      out.at(-1).items.push(m);
    }
    return out;
  }, [data, tab]);

  return (
    <div>
      <h1 className="mb-3 text-xl font-bold tracking-tight">Matches</h1>
      <Tabs tabs={TABS} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      <div className="mt-4">
        {loading && !data && <Spinner />}
        {error && !data && <ErrorState error={error} onRetry={reload} />}
        {data && !groups.length && <Empty>{tab === 'results' ? 'No results yet.' : 'No fixtures.'}</Empty>}
        {groups.map((g) => (
          <section key={g.key} className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2">{g.items.map((m) => <MatchCard key={m.id} match={m} />)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
