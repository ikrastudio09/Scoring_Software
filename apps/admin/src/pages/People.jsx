// Players of the selected category: private snapshot data, the two historical aggregates
// (correctable by hand, with a reason) and permanent identities across seasons and categories.
// Identities are only ever linked here, by an admin — never automatically.
import { useMemo, useState } from 'react';
import { PERFORMANCE_FIELDS, performanceText } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { useCategory } from '../lib/category.jsx';
import { Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Spinner, useToast } from '../components/ui.jsx';

const TABS = [['history', 'Previous performance'], ['players', 'Player identities'], ['teams', 'Team identities']];
const recordText = (r) => [r.category?.name, r.category?.season && `S${r.category.season}`, r.team?.name, r.playerID && `#${r.playerID}`].filter(Boolean).join(' · ');

function BlockEditor({ title, value, onChange }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PERFORMANCE_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input type="number" min="0" value={value[f.key] ?? ''} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

const toForm = (block) => Object.fromEntries(PERFORMANCE_FIELDS.map((f) => [f.key, block?.[f.key] ?? '']));
const fromForm = (form, original) => {
  const out = {};
  for (const f of PERFORMANCE_FIELDS) if (form[f.key] !== '' && form[f.key] !== null) out[f.key] = Number(form[f.key]);
  if (!Object.keys(out).length) return null;
  if (original?.supplied) out.supplied = original.supplied;
  if (original?.meta) out.meta = original.meta;
  return out;
};

function HistoryEditor({ player, onClose, onSaved }) {
  const toast = useToast();
  const h = player.history || {};
  const [prev, setPrev] = useState(toForm(h.previousYear));
  const [before, setBefore] = useState(toForm(h.overallPrevious));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try {
      await api.put(`/admin/players/${player.id}/history`, { previousYear: fromForm(prev, h.previousYear), overallPrevious: fromForm(before, h.overallPrevious), reason });
      toast('Previous performance saved', 'success');
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open wide title={`Previous performance — ${player.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 3} onClick={save}>Save</Button></>}>
      <div className="space-y-4 text-sm">
        {h.raw && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Source: <code>{h.raw}</code></p>}
        {h.flags?.map((f, i) => <p key={i} className="text-xs text-amber-800">⚠ {f.message}</p>)}
        <BlockEditor title="Previous year (last season only)" value={prev} onChange={setPrev} />
        <BlockEditor title="Overall previous (all seasons before last season)" value={before} onChange={setBefore} />
        <p className="text-xs text-slate-500">Leave a field blank when it is not known — it is then not shown, never treated as 0. A saved correction is kept by later auction re-imports.</p>
        <Field label="Reason (kept in the audit log)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. checked against the 2024 scorebook" /></Field>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

function HistoryTab({ scoped, search }) {
  const { data, error, reload } = useApi(api, scoped('/admin/players'));
  const [editing, setEditing] = useState(null);
  const rows = useMemo(() => (data?.players || []).filter((p) => p.name.toLowerCase().includes(search) || String(p.playerID ?? '').includes(search)), [data, search]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th className="px-3 py-2 text-left">ID</th><th className="text-left">Player</th><th className="text-left">Age</th><th className="text-left">Previous team</th><th className="text-left">Last season</th><th className="text-left">Before last season</th><th className="px-3" /></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-slate-100 align-top">
              <td className="tnum px-3 py-2 text-xs text-slate-400">{p.playerID ?? '—'}</td>
              <td className="py-2"><b>{p.name}</b><p className="text-xs text-slate-500">{p.team?.name}</p></td>
              <td className="tnum py-2">{p.age ?? '—'}</td>
              <td className="py-2 text-xs">{p.previousSeason?.team || '—'}{p.previousSeason?.points ? <span className="text-slate-400"> · {p.previousSeason.points}</span> : null}</td>
              <td className="py-2 text-xs">{performanceText(p.history?.previousYear) || '—'}</td>
              <td className="py-2 text-xs">
                {performanceText(p.history?.overallPrevious) || '—'}
                {p.history?.flags?.length > 0 && <p className="font-semibold text-amber-700" title={p.history.flags.map((f) => f.message).join('\n')}>⚠ {p.history.flags.length} note{p.history.flags.length > 1 ? 's' : ''}</p>}
                {p.history?.source === 'manual' && <p className="text-violet-700">corrected by {p.history.updatedBy}</p>}
              </td>
              <td className="px-3 py-2 text-right"><Button variant="ghost" size="px-2 py-1 text-xs" onClick={() => setEditing(p)}>Edit</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="p-4 text-sm text-slate-500">No players.</p>}
      {editing && <HistoryEditor player={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Card>
  );
}

/** Search all identities by name and link one (manual alternative to the suggestions). */
function FindIdentity({ player, onClose, onLink }) {
  const [q, setQ] = useState(player.name);
  const { data } = useApi(api, q.trim().length >= 2 ? `/admin/identities/players/search?q=${encodeURIComponent(q.trim())}` : null, [q]);
  const list = (data?.identities || []).filter((i) => i.id !== player.identity?.id);
  return (
    <Modal open wide title={`Find the same person as ${player.name}`} onClose={onClose}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" />
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {list.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2">
            <div className="flex-1"><b>{i.name}</b>{i.records.map((r) => <p key={r.id} className="text-xs text-slate-500">{recordText(r)}</p>)}</div>
            <Button size="px-3 py-1 text-xs" onClick={() => onLink(player, i)}>Same person</Button>
          </li>
        ))}
        {data && !list.length && <li className="py-2 text-slate-500">No other identity matches.</li>}
      </ul>
    </Modal>
  );
}

function PlayersTab({ scoped, search }) {
  const toast = useToast();
  const { data, error, reload } = useApi(api, scoped('/admin/identities/players'));
  const [finding, setFinding] = useState(null);
  const rows = useMemo(() => (data?.players || []).filter((p) => p.name.toLowerCase().includes(search)), [data, search]);
  const link = async (player, identity) => {
    if (!window.confirm(`Link ${player.name} (${player.team || ''}) to ${identity.name}?\n\nOnly do this if you are sure it is the same person.`)) return;
    try { await api.post(`/admin/players/${player.id}/identity`, { identityId: identity.id }); toast('Linked', 'success'); setFinding(null); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const split = async (player) => {
    if (!window.confirm(`Give ${player.name} an identity of their own (undo the link)?`)) return;
    try { await api.post(`/admin/players/${player.id}/identity`, { identityId: null }); toast('Separated', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">Auction playerIDs change every season, so each season record starts as a new person. Link records that are the same person; suggestions only compare names and are never applied automatically.</p>
      <Card className="divide-y divide-slate-100 text-sm">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-48 flex-1">
              <b>{p.name}</b> <span className="text-xs text-slate-500">{p.playerID ? `#${p.playerID} · ` : ''}{p.team}{p.previousTeam ? ` · prev: ${p.previousTeam}` : ''}</span>
              {p.identity?.otherRecords.length > 0
                ? <p className="text-xs text-emerald-700">Same person as: {p.identity.otherRecords.map(recordText).join('; ')}</p>
                : <p className="text-xs text-slate-400">No other season records linked</p>}
              {p.suggestions.map((s) => (
                <p key={s.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  Suggestion ({s.reason}): {s.records.map(recordText).join('; ') || s.name}
                  <Button variant="secondary" size="px-2 py-0.5 text-xs" onClick={() => link(p, s)}>Same person</Button>
                </p>
              ))}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="px-2 py-1 text-xs" onClick={() => setFinding(p)}>Find…</Button>
              {p.identity?.otherRecords.length > 0 && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => split(p)}>Unlink</Button>}
            </div>
          </div>
        ))}
        {!rows.length && <p className="p-4 text-slate-500">No players.</p>}
      </Card>
      {finding && <FindIdentity player={finding} onClose={() => setFinding(null)} onLink={link} />}
    </div>
  );
}

function TeamsTab({ scoped }) {
  const toast = useToast();
  const { data, error, reload } = useApi(api, scoped('/admin/identities/teams'));
  const act = async (team, identityId, msg) => {
    if (!window.confirm(msg)) return;
    try { await api.post(`/admin/teams/${team.id}/identity`, { identityId }); toast('Saved', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <Card className="divide-y divide-slate-100 text-sm">
      {data.teams.map((t) => {
        const others = (t.identity?.records || []).filter((r) => r.id !== t.id);
        return (
          <div key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="flex-1">
              <b>{t.name}</b>
              {others.length ? <p className="text-xs text-emerald-700">Same franchise as: {others.map(recordText).join('; ')}</p> : <p className="text-xs text-slate-400">No other season teams linked</p>}
              {t.identity?.aliases?.length > 0 && <p className="text-xs text-slate-500">Also known as: {t.identity.aliases.join(', ')}</p>}
              {t.suggestions.map((s) => (
                <p key={s.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-800">
                  Suggestion ({s.reason}): {s.records.map(recordText).join('; ') || s.name}
                  <Button variant="secondary" size="px-2 py-0.5 text-xs" onClick={() => act(t, s.id, `Link ${t.name} to ${s.name}? Only if it is the same franchise.`)}>Same franchise</Button>
                </p>
              ))}
            </div>
            {others.length > 0 && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => act(t, null, `Separate ${t.name} into its own franchise?`)}>Unlink</Button>}
          </div>
        );
      })}
    </Card>
  );
}

export default function People() {
  const { scoped, category } = useCategory();
  const [tab, setTab] = useState('history');
  const [q, setQ] = useState('');
  const search = q.trim().toLowerCase();
  return (
    <div>
      <PageHeader title={`${category?.name || ''} players`}>
        {tab !== 'teams' && <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or ID" />}
      </PageHeader>
      <div className="mb-3 flex gap-1" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
        ))}
      </div>
      {tab === 'history' && <HistoryTab scoped={scoped} search={search} />}
      {tab === 'players' && <PlayersTab scoped={scoped} search={search} />}
      {tab === 'teams' && <TeamsTab scoped={scoped} />}
    </div>
  );
}
