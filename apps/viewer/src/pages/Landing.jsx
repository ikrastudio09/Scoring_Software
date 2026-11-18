import { useEffect } from 'react';
import { Link } from 'react-router';
import { useApi, useLiveMatch } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { lastCategory } from '../lib/category.jsx';
import MatchCard from '../components/MatchCard.jsx';
import { LiveHero } from '../components/LivePanel.jsx';
import { Card, ErrorState, SectionTitle, Spinner } from '../components/ui.jsx';

/** The one live match of the tournament, whichever category it belongs to. */
function LiveNow({ active }) {
  const { live: view, lastEnvelope } = useLiveMatch({ api, live, matchId: active.matchId, channel: 'viewer' });
  if (!view?.current) return null;
  const key = active.category?.key || 'mens';
  return (
    <section className="mb-6">
      <SectionTitle>Live now · {active.category?.name}</SectionTitle>
      <Link to={`/${key}/matches/${active.matchId}`} className="block" aria-label="Open the live match">
        <LiveHero live={view} envelope={lastEnvelope} compact />
        <p className="mt-2 text-right text-sm font-semibold text-brand">Ball-by-ball commentary →</p>
      </Link>
    </section>
  );
}

function CategoryCard({ c, remembered, live: isLive }) {
  return (
    <Card className={`flex flex-col p-4 ${remembered ? 'ring-2 ring-brand/60' : ''}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{c.name}</h2>
          <p className="text-xs text-slate-500"><b className="tnum text-slate-800">{c.counts.completed}</b>/{c.counts.total} matches played</p>
        </div>
        {isLive && <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>}
      </div>
      <div className="flex-1 space-y-2">
        {c.next && <><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Next</p><MatchCard match={c.next} cat={c.key} /></>}
        {c.last && <><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Latest result</p><MatchCard match={c.last} cat={c.key} /></>}
        {!c.next && !c.last && <p className="py-4 text-sm text-slate-500">Fixtures will appear here.</p>}
      </div>
      <Link to={`/${c.key}`} className="mt-4 rounded-xl bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white">
        Open {c.name} →
      </Link>
    </Card>
  );
}

export default function Landing() {
  const { data, error, loading, reload } = useApi(api, '/overview');
  useEffect(() => live.onTournament((e) => { if (e.type === 'MATCH_STATUS_CHANGED') reload(); }), [reload]);
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const t = data.tournament;
  const remembered = lastCategory();
  return (
    <div>
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{t.season ? `Season ${t.season}` : 'Tournament'}</p>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{t.name}</h1>
      </div>
      {data.active?.inPlay && <LiveNow active={data.active} />}
      <div className="grid gap-4 md:grid-cols-3">
        {data.categories.map((c) => (
          <CategoryCard key={c.key} c={c} remembered={c.key === remembered} live={data.active?.inPlay && data.active.category?.key === c.key} />
        ))}
      </div>
    </div>
  );
}
