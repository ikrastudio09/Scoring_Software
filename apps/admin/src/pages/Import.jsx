// Auction / registration import: files → server validation → preview → confirm.
// Nothing is written until the admin confirms the exact data that was previewed.
import { useState } from 'react';
import { api } from '../lib/runtime.js';
import { readImportFile } from '../lib/importFiles.js';
import { Button, Card, ErrorBox, PageHeader, useToast } from '../components/ui.jsx';

const ACTION = {
  create: ['New', 'bg-emerald-100 text-emerald-800'],
  update: ['Update', 'bg-sky-100 text-sky-800'],
  link: ['Link existing', 'bg-violet-100 text-violet-800'],
  unchanged: ['Unchanged', 'bg-slate-100 text-slate-600'],
};

function Pill({ action }) {
  const [label, cls] = ACTION[action] || [action, 'bg-slate-100'];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{label}</span>;
}

function FilePick({ label, hint, file, onFile }) {
  return (
    <label className="block cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-4 text-sm hover:border-teal-500">
      <span className="block font-semibold text-slate-800">{label}</span>
      <span className="block text-xs text-slate-500">{file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : hint}</span>
      <input type="file" accept=".json,.ndjson,.csv,.xlsx" className="sr-only" onChange={(e) => onFile(e.target.files?.[0] || null)} />
    </label>
  );
}

export default function Import() {
  const toast = useToast();
  const [files, setFiles] = useState({ players: null, teams: null });
  const [payload, setPayload] = useState(null);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const setFile = (kind, f) => { setFiles((x) => ({ ...x, [kind]: f })); setReport(null); setDone(null); };

  const preview = async () => {
    setBusy(true); setErr(null); setReport(null); setDone(null);
    try {
      const body = { players: [], teams: [] };
      for (const kind of ['players', 'teams']) {
        if (!files[kind]) continue;
        const parsed = await readImportFile(files[kind]);
        body.players.push(...(parsed.players || []), ...(kind === 'players' ? parsed.rows || [] : []));
        body.teams.push(...(parsed.teams || []), ...(kind === 'teams' ? parsed.rows || [] : []));
      }
      setPayload(body);
      setReport(await api.post('/admin/import/auction/preview', body, { timeoutMs: 30000 }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.post('/admin/import/auction/commit', { ...payload, hash: report.hash }, { timeoutMs: 60000 });
      setDone(res.result);
      setReport(null);
      toast('Tournament data imported', 'success');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const counts = (c) => Object.entries(c || {}).map(([k, n]) => `${n} ${ACTION[k]?.[0].toLowerCase() || k}`).join(' · ') || 'none';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Import auction data" />
      <Card className="space-y-3 p-4 text-sm text-slate-600">
        <p>
          Load the players and teams exported from the auction / registration system. <b>playerID</b> and <b>teamID</b> are the only
          keys used to connect a player to a team — names are display only. After the import the scoring system has its own copy
          and does not need the auction system during matches. Phone numbers and ages are <b>never</b> imported.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilePick label="Players file" hint="Player export: .json, .csv or .xlsx (an .xlsx with Players and Teams sheets can go here alone)" file={files.players} onFile={(f) => setFile('players', f)} />
          <FilePick label="Teams file" hint="Team export with teamPlayers, or one row per team member (teamID, teamName, playerID)" file={files.teams} onFile={(f) => setFile('teams', f)} />
        </div>
        <Button disabled={busy || (!files.players && !files.teams)} onClick={preview}>{busy && !report ? 'Validating…' : 'Validate & preview'}</Button>
      </Card>

      <ErrorBox error={err} />

      {done && (
        <Card className="p-4 text-sm">
          <p className="font-semibold text-emerald-700">Import complete — tournament data ready.</p>
          <p className="mt-1 text-slate-600">Teams: {counts(done.teams)}. Players: {counts(done.players)}.</p>
        </Card>
      )}

      {report && (
        <>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">Import validation</h2>
            <ul className="space-y-1 text-sm">
              {report.checks.map((c) => (
                <li key={c.label} className={c.ok ? 'text-emerald-700' : 'font-semibold text-red-700'}>{c.ok ? '✓' : '✗'} {c.label}</li>
              ))}
            </ul>
            {report.info.map((i) => <p key={i.code} className="mt-2 text-xs text-slate-500">ℹ {i.message}</p>)}
          </Card>

          {report.errors.length > 0 && (
            <Card className="overflow-hidden ring-red-200">
              <p className="bg-red-50 px-4 py-2 text-sm font-semibold text-red-800">Errors — fix the source data and import again ({report.errors.length})</p>
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
                {report.errors.map((e, i) => <li key={i} className="px-4 py-2"><b>{e.ref}:</b> {e.message}</li>)}
              </ul>
            </Card>
          )}
          {report.warnings.length > 0 && (
            <Card className="overflow-hidden">
              <p className="bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900">Warnings ({report.warnings.length})</p>
              <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto text-sm">
                {report.warnings.map((w, i) => <li key={i} className="px-4 py-2"><b>{w.ref}:</b> {w.message}</li>)}
              </ul>
            </Card>
          )}

          {report.ok && (
            <>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <p className="flex-1 text-sm">Teams: <b>{counts(report.counts.teams)}</b>. Players: <b>{counts(report.counts.players)}</b>.</p>
                <Button disabled={busy} onClick={confirm}>{busy ? 'Importing…' : 'Confirm import'}</Button>
              </Card>
              <div className="grid gap-3 md:grid-cols-2">
                {report.teams.map((t) => (
                  <Card key={t.teamID} className="overflow-hidden text-sm">
                    <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 text-white">
                      <span className="tnum text-xs text-slate-400">#{t.teamID}</span><b className="flex-1">{t.name}</b><Pill action={t.action} />
                    </div>
                    <table className="w-full">
                      <tbody>
                        {t.players.map((p) => (
                          <tr key={p.playerID} className="border-t border-slate-100">
                            <td className="tnum px-3 py-1.5 text-xs text-slate-400">{p.playerID}</td>
                            <td className="py-1.5 font-medium">{p.name}<span className="ml-1 text-xs font-normal text-slate-500">{p.playerType}</span></td>
                            <td className="tnum px-2 text-right text-xs">{p.soldPoints.toLocaleString()}</td>
                            <td className="pr-3 text-right"><Pill action={p.action} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!t.players.length && <p className="px-3 py-2 text-xs text-slate-500">No players</p>}
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
