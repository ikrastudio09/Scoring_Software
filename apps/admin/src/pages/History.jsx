// Historical MPL records: upload → map columns → seasons & categories → validate → preview →
// identity choices → confirm → summary, plus the list of imports with undo.
// Nothing is written until "Confirm import", and only exactly what was previewed.
import { useEffect, useMemo, useState } from 'react';
import { performanceText } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { useCategory } from '../lib/category.jsx';
import { readImportFile } from '../lib/importFiles.js';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, useToast } from '../components/ui.jsx';

const KINDS = [['players', 'Player seasons'], ['teams', 'Team seasons']];
const CATS = [['mens', "Men's"], ['ladies', 'Ladies'], ['kids', 'Kids']];
const ACTION = { create: 'bg-emerald-100 text-emerald-800', replace: 'bg-amber-100 text-amber-900', skip: 'bg-slate-100 text-slate-600' };

function Imports() {
  const toast = useToast();
  const { data, reload } = useApi(api, '/admin/import/history');
  const undo = async (i) => {
    if (!window.confirm(`Undo the import of ${i.fileName || 'this file'}? Its rows are removed and any rows it replaced are put back.`)) return;
    try { const out = await api.del(`/admin/import/history/${i._id}`); toast(`Removed ${out.removed} rows, restored ${out.restored}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  if (!data) return <Spinner />;
  if (!data.imports.length) return <p className="text-sm text-slate-500">No historical imports yet.</p>;
  return (
    <Card className="divide-y divide-slate-100 text-sm">
      {data.imports.map((i) => (
        <div key={i._id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex-1">
            <b>{i.fileName || 'Import'}</b> <span className="text-slate-500">· {i.kind === 'players' ? 'player seasons' : 'team seasons'}{i.categoryKey ? ` · ${i.categoryKey}` : ''} · {new Date(i.createdAt).toLocaleString()} · {i.createdBy}</span>
            <p className="text-xs text-slate-500">{i.summary?.create || 0} new · {i.summary?.replace || 0} replaced · {i.summary?.skip || 0} skipped{i.undoneAt ? ` · undone by ${i.undoneBy}` : ''}</p>
          </div>
          {!i.undoneAt && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => undo(i)}>Undo</Button>}
        </div>
      ))}
    </Card>
  );
}

export default function History() {
  const toast = useToast();
  const { key: headerCategory } = useCategory();
  const fields = useApi(api, '/admin/import/history/fields');
  const [kind, setKind] = useState('players');
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [mapping, setMapping] = useState({});
  const [category, setCategory] = useState(headerCategory);
  const [categoryValues, setCategoryValues] = useState({});
  const [yearMap, setYearMap] = useState({ year: 2026, season: 21 });
  const [choices, setChoices] = useState({});
  const [overwrite, setOverwrite] = useState(false);
  const [report, setReport] = useState(null);
  const [stale, setStale] = useState(false); // inputs changed since the preview
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [nonce, setNonce] = useState(0);

  const columns = useMemo(() => [...new Set((rows || []).slice(0, 200).flatMap((r) => Object.keys(r)))], [rows]);
  const catValues = useMemo(() => (mapping.category ? [...new Set((rows || []).map((r) => String(r[mapping.category] ?? '').trim()).filter(Boolean))] : []), [rows, mapping.category]);
  useEffect(() => { setStale(true); }, [mapping, category, categoryValues, yearMap, choices, overwrite, kind]);

  const load = async (f) => {
    setFile(f); setReport(null); setDone(null); setErr(null); setChoices({});
    if (!f) { setRows(null); return; }
    try {
      const parsed = await readImportFile(f);
      const list = parsed.rows || parsed[kind] || parsed.players || parsed.teams || [];
      setRows(list);
      const cols = [...new Set(list.slice(0, 200).flatMap((r) => Object.keys(r)))];
      setMapping((await api.post('/admin/import/history/guess', { kind, columns: cols })).mapping);
    } catch (e) { setErr(e); setRows(null); }
  };
  useEffect(() => { if (file) load(file); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => {
    const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
    const b = { kind, fileName: file?.name, rows, mapping: clean, choices, overwrite };
    if (clean.category) b.categoryValues = Object.fromEntries(Object.entries(categoryValues).filter(([, v]) => v)); else b.category = category;
    if (clean.year && !clean.season) b.seasonFromYear = { year: Number(yearMap.year), season: Number(yearMap.season) };
    return b;
  };
  const preview = async () => {
    setBusy(true); setErr(null); setDone(null);
    try { setReport(await api.post('/admin/import/history/preview', body(), { timeoutMs: 60000 })); setStale(false); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.post('/admin/import/history/commit', { ...body(), hash: report.hash }, { timeoutMs: 120000 });
      setDone(res.result); setReport(null); setRows(null); setFile(null); setNonce((n) => n + 1);
      toast('History imported', 'success');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  // Explicit admin action: link every group that has exactly one same-name suggestion.
  const acceptSuggestions = () => {
    const next = { ...choices };
    for (const g of report.groups) if (g.suggestions.length === 1) next[g.key] = g.suggestions[0].id;
    setChoices(next);
  };

  const fieldList = fields.data?.fields?.[kind] || [];
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Import historical records" />
      <Card className="space-y-3 p-4 text-sm text-slate-600">
        <p>Load past seasons from a CSV, XLSX or JSON file: one row per player per season, or per team per season. Seasons scored in this system cannot be imported (they would count twice). Nothing is saved until you confirm, and every import can be undone.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Rows are"><Select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="File">
            <input key={nonce} type="file" accept=".csv,.xlsx,.json,.ndjson" className="block w-full text-sm" onChange={(e) => load(e.target.files?.[0] || null)} />
          </Field>
          {!mapping.category && <Field label="Category of every row"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>}
        </div>
      </Card>
      <ErrorBox error={err} />
      {done && <Card className="p-4 text-sm"><p className="font-semibold text-emerald-700">Imported: {done.create} new rows, {done.replace} replaced, {done.skip} skipped, {done.newIdentities} new people / teams.</p></Card>}

      {rows && (
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Columns <span className="text-sm font-normal text-slate-500">({rows.length} rows; check what each field is read from)</span></h2>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {fieldList.map((f) => (
              <Field key={f.key} label={`${f.key}${f.required ? ' *' : ''}`}>
                <Select value={mapping[f.key] || ''} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          {mapping.year && !mapping.season && (
            <div className="flex flex-wrap items-end gap-2 text-sm">
              <Field label="Year"><Input type="number" value={yearMap.year} onChange={(e) => setYearMap({ ...yearMap, year: e.target.value })} /></Field>
              <span className="pb-2">is MPL season</span>
              <Field label="Season"><Input type="number" value={yearMap.season} onChange={(e) => setYearMap({ ...yearMap, season: e.target.value })} /></Field>
            </div>
          )}
          {mapping.category && (
            <div className="grid gap-2 sm:grid-cols-4">
              {catValues.map((v) => (
                <Field key={v} label={`"${v}" means`}>
                  <Select value={categoryValues[v] || ''} onChange={(e) => setCategoryValues({ ...categoryValues, [v]: e.target.value })}>
                    <option value="">—</option>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </Field>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Replace rows already imported for the same person / team and season (otherwise they are kept)</label>
          <Button disabled={busy} onClick={preview}>{busy && !report ? 'Validating…' : report ? 'Preview again' : 'Validate & preview'}</Button>
        </Card>
      )}

      {report && (
        <>
          {report.errors.length > 0 && (
            <Card className="overflow-hidden ring-red-200">
              <p className="bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">Errors — nothing can be imported until they are fixed ({report.errors.length})</p>
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">{report.errors.map((e, i) => <li key={i} className="px-4 py-1.5">{e.row ? <b>Row {e.row}: </b> : null}{e.message}</li>)}</ul>
            </Card>
          )}
          {report.warnings.length > 0 && (
            <Card className="overflow-hidden">
              <p className="bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">Warnings ({report.warnings.length})</p>
              <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-sm">{report.warnings.map((w, i) => <li key={i} className="px-4 py-1.5">{w.row ? <b>Row {w.row}: </b> : null}{w.message}</li>)}</ul>
            </Card>
          )}
          {report.counts && (
            <Card className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-sm">{report.rowCount} rows · <b>{report.counts.create}</b> new · <b>{report.counts.replace}</b> replace · <b>{report.counts.skip}</b> skip · <b>{report.counts.newIdentities}</b> new {kind === 'players' ? 'people' : 'teams'}</p>
                <Button variant="secondary" onClick={acceptSuggestions}>Link every single same-name suggestion</Button>
                <Button disabled={busy || !report.ok || stale} onClick={confirm} title={stale ? 'Preview again after changing anything' : ''}>{busy ? 'Importing…' : 'Confirm import'}</Button>
              </div>
              {stale && <p className="text-xs text-amber-700">You changed something since this preview — preview again before confirming.</p>}
              <p className="text-xs text-slate-500">Each {kind === 'players' ? 'person' : 'team'} starts as new. Choose an existing identity only when you are sure it is the same {kind === 'players' ? 'person' : 'franchise'} — name suggestions are never applied on their own.</p>
            </Card>
          )}
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">{kind === 'players' ? 'Person' : 'Team'}</th><th className="text-left">Is</th><th className="text-left">Seasons in the file</th></tr></thead>
              <tbody>
                {report.groups.map((g) => (
                  <tr key={g.key} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-medium">{g.name}</td>
                    <td className="py-2 pr-3">
                      <Select value={choices[g.key] || 'new'} onChange={(e) => setChoices({ ...choices, [g.key]: e.target.value })}>
                        <option value="new">A new {kind === 'players' ? 'person' : 'team'}</option>
                        {g.suggestions.map((s) => <option key={s.id} value={s.id}>Same as {s.name} ({s.reason})</option>)}
                      </Select>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {g.rows.map((r) => (
                        <p key={r.row}>
                          <span className={`mr-1 rounded px-1 text-[10px] font-bold uppercase ${ACTION[r.action]}`}>{r.action}</span>
                          S{r.season} {r.categoryKey !== category || mapping.category ? `· ${r.categoryKey} ` : ''}{r.team ? `· ${r.team} ` : ''}
                          {r.totals ? `· ${performanceText(r.totals) || ''}` : `· ${r.matches ?? '–'} m, ${r.won ?? '–'} w, ${r.points ?? '–'} pts${r.champion ? ' · champion' : r.finalist ? ' · finalist' : ''}`}
                        </p>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <h2 className="pt-2 font-semibold">Previous imports</h2>
      <Imports key={nonce} />
    </div>
  );
}
