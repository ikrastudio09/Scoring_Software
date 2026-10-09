import { useEffect, useState } from 'react';
import { MATCH_STAGES } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Button, Card, ErrorBox, Field, Input, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui.jsx';

const n = (v) => (v === '' ? undefined : Number(v));

const TIEBREAK_PRESETS = [
  ['nrr,wins,headToHead', 'Net run rate → wins → head-to-head'],
  ['headToHead,nrr,wins', 'Head-to-head → net run rate → wins'],
  ['wins,nrr,headToHead', 'Wins → net run rate → head-to-head'],
  ['wins,headToHead,nrr', 'Wins → head-to-head → net run rate'],
];
const WEIGHT_LABELS = {
  batting: { run: 'per run', four: 'per four (bonus)', six: 'per six (bonus)', fifty: '50+ bonus', hundred: '100+ bonus', runsAbovePar: '× runs above match rate', duck: 'duck' },
  bowling: { wicket: 'per wicket', topOrderWicket: 'top-order (1–4) wicket bonus', dot: 'per dot ball', maiden: 'per maiden', threeWickets: '3-wicket bonus', runsSavedVsPar: '× runs saved vs match rate' },
  fielding: { catch: 'per catch', runOut: 'per run out', stumping: 'per stumping' },
  context: { chaseWinPct: '% bonus of batting in a won chase', defendWinPct: '% bonus of bowling in a won defence' },
};

/** MVP impact weights (engine/impact.js). Auction value is deliberately not a weight. */
function ImpactWeights({ weights, setWeights, onReset }) {
  if (!weights) return null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">MVP impact weights <span className="text-sm font-normal text-slate-500">(applied immediately to all matches)</span></h2>
        <Button variant="ghost" size="px-2 py-1 text-xs" onClick={onReset}>Reset to defaults</Button>
      </div>
      {Object.entries(WEIGHT_LABELS).map(([group, labels]) => (
        <div key={group}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {Object.entries(labels).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input type="number" step="0.5" value={weights[group]?.[k] ?? ''} onChange={(e) => setWeights({ ...weights, [group]: { ...weights[group], [k]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </div>
      ))}
    </Card>
  );
}

export function TournamentSettings() {
  const toast = useToast();
  const { data, error, reload } = useApi(api, '/tournament');
  const mvp = useApi(api, '/stats/mvp');
  const [f, setF] = useState(null);
  const [weights, setWeights] = useState(null);
  const [resetWeights, setResetWeights] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ ...data.tournament, venuesText: (data.tournament.venues || []).join('\n') }); }, [data]);
  useEffect(() => { if (mvp.data) { setWeights(mvp.data.weights); setResetWeights(false); } }, [mvp.data]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!f) return <Spinner />;
  const r = f.rules;
  const p = f.points;
  const bonus = { enabled: true, points: 1, runsPercent: 75, oversPercent: 75, ...(p.bonus || {}) };
  const setBonus = (k, v) => setPts('bonus', { ...bonus, [k]: v });
  const setRule = (k, v) => setF({ ...f, rules: { ...r, [k]: v } });
  const setPts = (k, v) => setF({ ...f, points: { ...p, [k]: v } });
  const save = async () => {
    setErr(null);
    try {
      await api.put('/tournament', {
        name: f.name, shortName: f.shortName || undefined, season: f.season || undefined, description: f.description || undefined,
        logoUrl: f.logoUrl || undefined, primaryColor: f.primaryColor, accentColor: f.accentColor,
        venues: f.venuesText.split('\n').map((x) => x.trim()).filter(Boolean),
        rules: {
          oversPerInnings: n(r.oversPerInnings), ballsPerOver: n(r.ballsPerOver), maxOversPerBowler: n(r.maxOversPerBowler),
          playersPerSide: n(r.playersPerSide), wideRuns: n(r.wideRuns), noBallRuns: n(r.noBallRuns), freeHit: Boolean(r.freeHit),
        },
        points: {
          win: n(p.win), loss: n(p.loss), tie: n(p.tie), noResult: n(p.noResult), stages: p.stages, nrrAllOutUsesFullQuota: Boolean(p.nrrAllOutUsesFullQuota),
          tiebreakers: (p.tiebreakers?.length ? p.tiebreakers : ['nrr', 'wins', 'headToHead']),
          bonus: { enabled: Boolean(bonus.enabled), points: n(bonus.points), runsPercent: n(bonus.runsPercent), oversPercent: n(bonus.oversPercent) },
        },
        impactWeights: resetWeights ? null : weights && Object.fromEntries(Object.entries(weights).map(([g, o]) => [g, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]))])),
      });
      toast('Settings saved', 'success');
      reload();
      mvp.reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Tournament settings"><Button onClick={save}>Save</Button></PageHeader>
      <ErrorBox error={err} />
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Branding</h2>
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Short name"><Input value={f.shortName || ''} onChange={(e) => setF({ ...f, shortName: e.target.value })} /></Field>
        <Field label="Season"><Input value={f.season || ''} onChange={(e) => setF({ ...f, season: e.target.value })} /></Field>
        <Field label="Logo URL"><Input value={f.logoUrl || ''} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} /></Field>
        <Field label="Primary colour"><Input type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} /></Field>
        <Field label="Accent colour"><Input type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Venues (one per line)" className="sm:col-span-2"><Textarea value={f.venuesText} onChange={(e) => setF({ ...f, venuesText: e.target.value })} /></Field>
      </Card>
      <Card className="grid gap-3 p-4 sm:grid-cols-3">
        <h2 className="font-semibold sm:col-span-3">Playing rules <span className="text-sm font-normal text-slate-500">(defaults for new fixtures; a fixture keeps the rules it was created with)</span></h2>
        <Field label="Overs per innings"><Input type="number" min="1" value={r.oversPerInnings} onChange={(e) => setRule('oversPerInnings', e.target.value)} /></Field>
        <Field label="Max overs per bowler"><Input type="number" min="1" value={r.maxOversPerBowler} onChange={(e) => setRule('maxOversPerBowler', e.target.value)} /></Field>
        <Field label="Balls per over"><Input type="number" min="4" max="8" value={r.ballsPerOver} onChange={(e) => setRule('ballsPerOver', e.target.value)} /></Field>
        <Field label="Max players per side"><Input type="number" min="2" max="15" value={r.playersPerSide} onChange={(e) => setRule('playersPerSide', e.target.value)} /></Field>
        <Field label="Wide penalty runs"><Input type="number" min="0" value={r.wideRuns} onChange={(e) => setRule('wideRuns', e.target.value)} /></Field>
        <Field label="No-ball penalty runs"><Input type="number" min="0" value={r.noBallRuns} onChange={(e) => setRule('noBallRuns', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(r.freeHit)} onChange={(e) => setRule('freeHit', e.target.checked)} /> Free hit after a no-ball</label>
      </Card>
      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        <h2 className="font-semibold sm:col-span-4">Points table</h2>
        <Field label="Win"><Input type="number" value={p.win} onChange={(e) => setPts('win', e.target.value)} /></Field>
        <Field label="Loss"><Input type="number" value={p.loss} onChange={(e) => setPts('loss', e.target.value)} /></Field>
        <Field label="Tie"><Input type="number" value={p.tie} onChange={(e) => setPts('tie', e.target.value)} /></Field>
        <Field label="No result"><Input type="number" value={p.noResult} onChange={(e) => setPts('noResult', e.target.value)} /></Field>
        <Field label="Stages counted" className="sm:col-span-2">
          <Select multiple value={p.stages} onChange={(e) => setPts('stages', [...e.target.selectedOptions].map((o) => o.value))}>{MATCH_STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={Boolean(p.nrrAllOutUsesFullQuota)} onChange={(e) => setPts('nrrAllOutUsesFullQuota', e.target.checked)} /> NRR: charge a bowled-out side its full quota of overs</label>
        <Field label="Teams level on points are separated by" className="sm:col-span-4">
          <Select value={(p.tiebreakers?.length ? p.tiebreakers : ['nrr', 'wins', 'headToHead']).join(',')} onChange={(e) => setPts('tiebreakers', e.target.value.split(','))}>
            {TIEBREAK_PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-4"><input type="checkbox" checked={Boolean(bonus.enabled)} onChange={(e) => setBonus('enabled', e.target.checked)} /> Bonus point for a dominant win</label>
        {bonus.enabled && (
          <>
            <Field label="Bonus points"><Input type="number" min="0" max="5" value={bonus.points} onChange={(e) => setBonus('points', e.target.value)} /></Field>
            <Field label="Defending: chase held below (% of target)" className="sm:col-span-3"><Input type="number" min="1" max="100" value={bonus.runsPercent} onChange={(e) => setBonus('runsPercent', e.target.value)} /></Field>
            <Field label="Chasing: target reached within (% of overs)" className="sm:col-span-4"><Input type="number" min="1" max="100" value={bonus.oversPercent} onChange={(e) => setBonus('oversPercent', e.target.value)} /></Field>
            <p className="text-xs text-slate-500 sm:col-span-4">Example at 75%: target 60 → the chasing side must finish on 44 or less; 8-over match → the chase must be completed within 6.0 overs. Super Over wins never earn a bonus. A tie outside the league stage is always decided by a Super Over.</p>
          </>
        )}
      </Card>
      <ImpactWeights weights={weights} setWeights={(w) => { setWeights(w); setResetWeights(false); }} onReset={() => { setResetWeights(true); setWeights(null); toast('Defaults will be restored when you save', 'info'); }} />
    </div>
  );
}

export function Users() {
  const toast = useToast();
  const { data, error, reload } = useApi(api, '/auth/users');
  const [f, setF] = useState({ username: '', password: '', role: 'scorer', name: '' });
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const create = async () => {
    try { await api.post('/auth/users', { ...f, name: f.name || undefined }); toast('User created', 'success'); setF({ username: '', password: '', role: 'scorer', name: '' }); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Users" />
      <Card className="mb-4 divide-y divide-slate-100">
        {data.users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="flex-1 font-medium">{u.username}{u.name ? <span className="font-normal text-slate-500"> · {u.name}</span> : ''}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase">{u.role}</span>
            <span className="w-40 text-right text-xs text-slate-500">{u.lastLoginAt ? `last login ${new Date(u.lastLoginAt).toLocaleString()}` : 'never logged in'}</span>
          </div>
        ))}
      </Card>
      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Add user</h2>
        <Field label="Username"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="Display name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Password" hint="At least 10 characters"><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Role" hint="Scorers can score and confirm results; admins can also manage the tournament."><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="scorer">Scorer</option><option value="admin">Admin</option></Select></Field>
        <div className="sm:col-span-2"><Button disabled={f.username.length < 3 || f.password.length < 10} onClick={create}>Create user</Button></div>
      </Card>
    </div>
  );
}

export function Tools() {
  const toast = useToast();
  const metrics = useApi(api, '/admin/metrics');
  const audit = useApi(api, '/admin/audit?limit=100');
  const [busy, setBusy] = useState(false);
  const run = async (path, label) => {
    setBusy(true);
    try { const out = await api.post(path); toast(`${label}: ${JSON.stringify(out)}`, 'success', 6000); metrics.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const m = metrics.data;
  return (
    <div className="space-y-4">
      <PageHeader title="System">
        <Button variant="secondary" disabled={busy} onClick={() => run('/admin/stats/rebuild', 'Statistics rebuilt')}>Rebuild statistics</Button>
        <Button variant="secondary" disabled={busy} onClick={() => run('/admin/reconcile', 'Reconciled')}>Verify match documents</Button>
        <Button variant="ghost" onClick={metrics.reload}>Refresh</Button>
      </PageHeader>
      {m && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Uptime', `${Math.floor(m.uptimeSec / 3600)}h ${Math.floor((m.uptimeSec % 3600) / 60)}m`],
            ['Memory (RSS)', `${m.memoryMb.rss} MB`],
            ['Sockets', `${m.sockets.connected} (led ${m.sockets.byChannel.led}, viewers ${m.sockets.byChannel.viewer}, admin ${m.sockets.byChannel.admin})`],
            ['Database', m.db.state],
            ['Scoring commands', `${m.scoring.commands} (${m.scoring.rejected} rejected, ${m.scoring.duplicates} duplicates)`],
            ['Scoring latency p50/p95', `${m.scoring.latency.p50 ?? '-'} / ${m.scoring.latency.p95 ?? '-'} ms`],
            ['DB write p50/p95', `${m.scoring.dbWrite.p50 ?? '-'} / ${m.scoring.dbWrite.p95 ?? '-'} ms`],
            ['HTTP p95 / 5xx', `${m.http.latency.p95 ?? '-'} ms / ${m.http.errors5xx}`],
            ['Event loop p99', `${m.eventLoopDelayMs.p99} ms`],
            ['Stats rebuilds / failures', `${m.stats.rebuilds} / ${m.stats.failures}`],
          ].map(([k, v]) => <Card key={k} className="p-3"><p className="text-xs text-slate-500">{k}</p><p className="font-semibold tnum">{v}</p></Card>)}
        </div>
      )}
      <Card className="overflow-x-auto">
        <h2 className="px-4 py-3 font-semibold">Audit log</h2>
        <table className="w-full min-w-[640px] text-sm">
          <tbody>
            {(audit.data?.entries || []).map((e) => (
              <tr key={e._id} className="border-t border-slate-100">
                <td className="px-4 py-1.5 text-xs text-slate-500">{new Date(e.at).toLocaleString()}</td>
                <td className="font-medium">{e.action}</td>
                <td className="text-xs">{e.user?.username}</td>
                <td className="max-w-md truncate px-4 text-xs text-slate-500">{e.details ? JSON.stringify(e.details) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
