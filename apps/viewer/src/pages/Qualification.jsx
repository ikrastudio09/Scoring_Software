// Qualification scenarios for one category: the real picture and a what-if calculator.
// Simulated results are sent to the server, computed in memory and discarded — never stored.
import { useEffect, useMemo, useState } from 'react';
import { formatNrr } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { CatLink, useCategory } from '../lib/category.jsx';
import { Card, ErrorState, SectionTitle, Spinner, Tabs, TeamLogo } from '../components/ui.jsx';

const STATUS_STYLE = {
  QUALIFIED: 'bg-emerald-600 text-white', SECURED: 'bg-emerald-600 text-white', ELIMINATED: 'bg-slate-300 text-slate-700',
  NRR_ONLY: 'bg-amber-100 text-amber-900', NRR_DEPENDENT: 'bg-amber-100 text-amber-900', MUST_WIN: 'bg-orange-100 text-orange-900',
  WIN_AND_DEPEND: 'bg-sky-100 text-sky-900', IN_OWN_HANDS: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200', IN_CONTENTION: 'bg-slate-100 text-slate-700',
};

function Badge({ row }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[row.status] || STATUS_STYLE.IN_CONTENTION}`}>{row.label}</span>;
}

/** Share of all result combinations — only for teams whose fate is still open. */
function Share({ row }) {
  const c = row.combinations;
  if (!c || row.certainty === 'guaranteed') return null;
  const pct = (n) => Math.round((n / c.total) * 100);
  return (
    <p className="text-[11px] text-slate-500">
      Through on points in {pct(c.outright)}% of the {c.total.toLocaleString()} possible result combinations{c.tieBreak ? `; level on points (NRR decides) in ${pct(c.tieBreak)}%` : ''}.
    </p>
  );
}

function Picture({ data, hypothetical }) {
  return data.groups.map((g) => (
    <Card key={g.group || 'all'} className={`mb-4 overflow-hidden ${hypothetical ? 'ring-2 ring-violet-300' : ''}`}>
      {(data.groups.length > 1 || g.final) && (
        <p className="bg-slate-50 px-4 py-2 text-sm font-semibold">
          {data.groups.length > 1 ? `Group ${g.group}` : ''}{g.final ? `${data.groups.length > 1 ? ' · ' : ''}League stage complete` : ''}
        </p>
      )}
      <ul>
        {g.rows.map((r) => (
          <li key={r.team.id} className={`flex gap-3 border-t border-slate-100 px-4 py-3 first:border-0 ${r.position === data.rules.slots ? 'border-b-2 border-b-slate-300' : ''}`}>
            <span className="w-5 pt-1 text-sm tnum text-slate-400">{r.position}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CatLink to={`/teams/${r.team.id}`} className="flex items-center gap-2 font-semibold hover:text-brand">
                  <TeamLogo team={r.team} size="h-6 w-6 text-[8px]" />{r.team.name}
                </CatLink>
                <Badge row={r} />
              </div>
              <p className="mt-0.5 text-xs text-slate-600">{r.text}</p>
              <Share row={r} />
            </div>
            <div className="shrink-0 text-right text-xs text-slate-500">
              <p><b className="tnum text-base text-slate-900">{r.points}</b> pts</p>
              <p className="tnum">NRR {formatNrr(r.nrr)}</p>
              {r.remaining > 0 && <p className="tnum">max {r.maxPoints} · {r.remaining} left</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  ));
}

const OUTCOMES = [['A', 'wins'], ['T', 'Tie'], ['N', 'No result'], ['B', 'wins']];
const blankScore = { battedFirst: 'teamA', teamA: { runs: '', wickets: '', overs: '' }, teamB: { runs: '', wickets: '', overs: '' } };

function FixturePicker({ m, teamOf, pick, setPick, bonusOn }) {
  const p = pick || {};
  const set = (patch) => setPick({ ...p, ...patch });
  const A = teamOf(m.teamA);
  const B = teamOf(m.teamB);
  const sc = p.score;
  const side = (k, team) => (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="w-12 truncate font-semibold">{team?.shortName}</span>
      {['runs', 'wickets', 'overs'].map((f) => (
        <input key={f} aria-label={`${team?.shortName} ${f}`} placeholder={f === 'overs' ? 'ov 9.4' : f === 'runs' ? 'runs' : 'wkts'} value={sc[k][f]}
          onChange={(e) => set({ score: { ...sc, [k]: { ...sc[k], [f]: e.target.value } } })}
          className="w-16 rounded-lg border border-slate-300 px-2 py-1 tnum" inputMode={f === 'overs' ? 'decimal' : 'numeric'} />
      ))}
    </div>
  );
  return (
    <div className="border-t border-slate-100 px-4 py-3 first:border-0">
      <p className="mb-2 text-xs text-slate-500">Match {m.number}: <b className="text-slate-800">{A?.name}</b> v <b className="text-slate-800">{B?.name}</b></p>
      <div className="flex flex-wrap gap-1.5">
        {OUTCOMES.map(([code, label]) => (
          <button key={code} type="button" onClick={() => set({ outcome: p.outcome === code ? undefined : code, score: code === 'N' ? undefined : p.score })}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ${p.outcome === code ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-700 ring-slate-300'}`}>
            {code === 'A' ? `${A?.shortName} ${label}` : code === 'B' ? `${B?.shortName} ${label}` : label}
          </button>
        ))}
        {p.outcome && p.outcome !== 'N' && !sc && (
          <button type="button" onClick={() => set({ score: blankScore })} className="rounded-lg px-2 py-1 text-xs font-medium text-brand">+ score (for NRR)</button>
        )}
        {bonusOn && (p.outcome === 'A' || p.outcome === 'B') && !sc && (
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={Boolean(p.bonus)} onChange={(e) => set({ bonus: e.target.checked })} /> bonus point</label>
        )}
      </div>
      {sc && (
        <div className="mt-2 space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-slate-600">Batted first
            <select value={sc.battedFirst} onChange={(e) => set({ score: { ...sc, battedFirst: e.target.value } })} className="rounded-lg border border-slate-300 px-2 py-1">
              <option value="teamA">{A?.shortName}</option><option value="teamB">{B?.shortName}</option>
            </select>
            <button type="button" onClick={() => set({ score: undefined })} className="ml-auto text-slate-400">remove score</button>
          </label>
          <div className="flex gap-1.5 pl-[3.375rem] text-[10px] uppercase tracking-wide text-slate-400"><span className="w-16">Runs</span><span className="w-16">Wkts</span><span className="w-16">Overs</span></div>
          {side('teamA', A)}
          {side('teamB', B)}
        </div>
      )}
    </div>
  );
}

function WhatIf({ base, scoped, categoryKey }) {
  const [picks, setPicks] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const teamMap = useMemo(() => new Map(base.groups.flatMap((g) => g.rows).map((r) => [r.team.id, r.team])), [base]);
  const chosen = Object.entries(picks).filter(([, p]) => p?.outcome);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const results = chosen.map(([matchId, p]) => {
        const out = { matchId, outcome: p.outcome };
        if (p.bonus) out.bonus = true;
        if (p.score) {
          const s = (x) => ({ runs: Number(x.runs), wickets: Number(x.wickets), overs: String(x.overs) });
          out.score = { battedFirst: p.score.battedFirst, teamA: s(p.score.teamA), teamB: s(p.score.teamB) };
        }
        return out;
      });
      setResult(await api.post('/qualification/what-if', { category: categoryKey, results }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const reset = () => { setPicks({}); setResult(null); setError(null); };
  if (!base.remaining.length) return <Card className="p-4 text-sm text-slate-500">No league matches left to simulate.</Card>;
  return (
    <div>
      <Card className="overflow-hidden">
        <p className="bg-slate-50 px-4 py-2 text-xs text-slate-600">Pick results for any remaining matches. Add a score to include a match in net run rate. Nothing you enter is saved.</p>
        {base.remaining.map((m) => (
          <FixturePicker key={m.id} m={m} teamOf={(id) => teamMap.get(id)} pick={picks[m.id]} setPick={(p) => setPicks({ ...picks, [m.id]: p })} bonusOn={Boolean(base.rules.bonus)} />
        ))}
        <div className="flex gap-2 border-t border-slate-100 px-4 py-3">
          <button type="button" disabled={!chosen.length || busy} onClick={run} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Calculating…' : `Calculate (${chosen.length})`}</button>
          <button type="button" onClick={reset} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-300">Reset to actual standings</button>
        </div>
      </Card>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error.message}</p>}
      {result && (
        <>
          <SectionTitle>Hypothetical standings</SectionTitle>
          <p className="mb-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            HYPOTHETICAL — {result.simulated} simulated result{result.simulated === 1 ? '' : 's'}; not real.
            {result.nrrExcludes.length > 0 && ` Net run rate does not include simulated match${result.nrrExcludes.length > 1 ? 'es' : ''} ${result.nrrExcludes.join(', ')} (no score entered).`}
          </p>
          <Picture data={result} hypothetical />
        </>
      )}
    </div>
  );
}

export default function Qualification() {
  const { scoped, key, category } = useCategory();
  const { data, error, reload } = useApi(api, scoped('/qualification'));
  const [tab, setTab] = useState('current');
  useEffect(() => live.onTournament((e) => {
    if ((e.type === 'POINTS_TABLE_UPDATED' && (!e.category || e.category === key)) || e.type === 'MATCH_STATUS_CHANGED') reload();
  }), [reload, key]);
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const r = data.rules;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{category?.name}</p>
      <h1 className="mb-1 text-xl font-bold tracking-tight">Qualification</h1>
      <p className="mb-3 text-xs text-slate-500">
        Top {r.slots} qualify · Win {r.win} · Tie {r.tie} · No result {r.noResult}{r.bonus ? ` · Bonus +${r.bonus.points}` : ''} · {data.remaining.length} league match{data.remaining.length === 1 ? '' : 'es'} left
      </p>
      <Tabs tabs={[{ value: 'current', label: 'Current' }, { value: 'whatif', label: 'What-if' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'current' ? <Picture data={data} /> : <WhatIf base={data} scoped={scoped} categoryKey={key} />}
      </div>
      <Card className="mt-2 p-4 text-xs leading-relaxed text-slate-500">
        <b className="text-slate-700">How to read this.</b> “Qualified”, “Qualification secured” and “Eliminated” are mathematical: they hold for every
        possible combination of the remaining results. “Depends on NRR” means only teams finishing level on points could change it — net run rate
        (then {r.tiebreakers.slice(1).map((t) => ({ wins: 'wins', headToHead: 'head-to-head' }[t] || t)).join(', ')}) decides those. Percentages count every
        combination of results once; they describe the possibilities, they are not forecasts.
      </Card>
    </div>
  );
}
