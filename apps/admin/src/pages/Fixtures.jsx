import { useState } from 'react';
import { Link } from 'react-router';
import { MATCH_STAGES } from '@cricket/shared';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, fmtDateTime, toLocalInput, useToast } from '../components/ui.jsx';

const EMPTY = { teamA: '', teamB: '', teamALabel: '', teamBLabel: '', venue: '', scheduledAt: '', stage: 'league', group: '', overs: '' };

function FixtureForm({ open, onClose, initial, teams, venues, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const editing = Boolean(initial.id);
  const save = async () => {
    setBusy(true);
    setErr(null);
    const body = {
      stage: f.stage, venue: f.venue || undefined, group: f.group || undefined,
      teamA: f.teamA || null, teamB: f.teamB || null, teamALabel: f.teamALabel || undefined, teamBLabel: f.teamBLabel || undefined,
      scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : undefined,
    };
    if (f.overs) body.rules = { oversPerInnings: Number(f.overs) };
    if (f.number) body.number = Number(f.number);
    try {
      if (editing) await api.put(`/matches/${initial.id}`, body); else await api.post('/matches', body);
      toast(editing ? 'Fixture updated' : 'Fixture created', 'success');
      onSaved();
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit match ${initial.number}` : 'New fixture'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Team A"><Select value={f.teamA} onChange={(e) => setF({ ...f, teamA: e.target.value })}><option value="">TBD</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="Team B"><Select value={f.teamB} onChange={(e) => setF({ ...f, teamB: e.target.value })}><option value="">TBD</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        {!f.teamA && <Field label="Team A placeholder" hint="e.g. Winner SF1"><Input value={f.teamALabel} onChange={(e) => setF({ ...f, teamALabel: e.target.value })} /></Field>}
        {!f.teamB && <Field label="Team B placeholder"><Input value={f.teamBLabel} onChange={(e) => setF({ ...f, teamBLabel: e.target.value })} /></Field>}
        <Field label="Date & time"><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></Field>
        <Field label="Venue">
          <Input list="venues" value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />
          <datalist id="venues">{venues.map((v) => <option key={v} value={v} />)}</datalist>
        </Field>
        <Field label="Stage"><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{MATCH_STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Group (optional)"><Input value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} /></Field>
        <Field label="Overs per innings" hint="Blank = tournament default. Locked once scoring starts."><Input type="number" min="1" max="50" value={f.overs} onChange={(e) => setF({ ...f, overs: e.target.value })} /></Field>
        <Field label="Match number" hint="Blank = next number"><Input type="number" min="1" value={f.number || ''} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function StatusMenu({ match, onDone }) {
  const toast = useToast();
  const options = {
    SCHEDULED: ['POSTPONED', 'CANCELLED', 'ABANDONED'], READY: ['SCHEDULED', 'POSTPONED', 'CANCELLED', 'ABANDONED'],
    POSTPONED: ['SCHEDULED', 'CANCELLED'], CANCELLED: ['SCHEDULED'], ABANDONED: match.stateVersion ? [] : ['SCHEDULED'],
  }[match.status] || [];
  if (!options.length) return null;
  return (
    <Select value="" aria-label="Change status" onChange={async (e) => {
      const status = e.target.value;
      if (!status || !window.confirm(`Change match ${match.number} to ${status}?`)) return;
      try { await api.post(`/matches/${match.id}/status`, { status }); toast(`Match ${status.toLowerCase()}`, 'success'); onDone(); } catch (err) { toast(err.message, 'error'); }
    }}>
      <option value="">Status…</option>
      {options.map((o) => <option key={o} value={o}>{o === 'SCHEDULED' ? 'Reschedule' : o.charAt(0) + o.slice(1).toLowerCase()}</option>)}
    </Select>
  );
}

export default function Fixtures() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const matches = useApi(api, '/matches');
  const teams = useApi(api, '/teams');
  const t = useApi(api, '/tournament');
  const [form, setForm] = useState(null);
  if (matches.error && !matches.data) return <ErrorBox error={matches.error} onRetry={matches.reload} />;
  if (!matches.data || !teams.data || !t.data) return <Spinner />;

  const edit = (m) => setForm({
    id: m.id, number: m.number, teamA: m.teamA?.id || '', teamB: m.teamB?.id || '', teamALabel: m.teamALabel || '', teamBLabel: m.teamBLabel || '',
    venue: m.venue || '', scheduledAt: toLocalInput(m.scheduledAt), stage: m.stage, group: m.group || '', overs: String(m.rules.oversPerInnings),
  });
  const del = async (m) => {
    if (!window.confirm(`Delete match ${m.number}?`)) return;
    try { await api.del(`/matches/${m.id}`); toast('Fixture deleted', 'success'); matches.reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <PageHeader title={`Fixtures (${matches.data.matches.length})`}>{isAdmin && <Button onClick={() => setForm({ ...EMPTY })}>New fixture</Button>}</PageHeader>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-3 py-2 text-left">#</th><th className="text-left">Match</th><th className="text-left">When / where</th><th className="text-left">Format</th><th className="text-left">Status</th><th className="px-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {matches.data.matches.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="tnum px-3 py-2">{m.number}</td>
                <td>
                  <p className="font-medium">{m.teamA?.name || 'TBD'} v {m.teamB?.name || 'TBD'}</p>
                  <p className="text-xs text-slate-500">{m.stage.replace('_', ' ')}{m.group ? ` · Group ${m.group}` : ''}{m.result?.text ? ` · ${m.result.text}` : ''}</p>
                </td>
                <td className="text-xs">{fmtDateTime(m.scheduledAt)}<br /><span className="text-slate-500">{m.venue}</span></td>
                <td className="text-xs">{m.rules.oversPerInnings} ov</td>
                <td><StatusBadge status={m.status} /></td>
                <td className="px-3">
                  <div className="flex items-center justify-end gap-1">
                    {['SCHEDULED', 'READY'].includes(m.status) && m.teamA?.id && m.teamB?.id && <Link to={`/matches/${m.id}/setup`}><Button variant="secondary" size="px-2 py-1 text-xs">Setup</Button></Link>}
                    <Link to={`/matches/${m.id}/score`}><Button variant="secondary" size="px-2 py-1 text-xs">Score</Button></Link>
                    {isAdmin && <Button variant="ghost" size="px-2 py-1 text-xs" onClick={() => edit(m)}>Edit</Button>}
                    {isAdmin && <div className="w-28"><StatusMenu match={m} onDone={matches.reload} /></div>}
                    {isAdmin && ['SCHEDULED', 'POSTPONED', 'CANCELLED'].includes(m.status) && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => del(m)}>Delete</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {form && <FixtureForm open onClose={() => setForm(null)} initial={form} teams={teams.data.teams} venues={t.data.tournament.venues || []} onSaved={matches.reload} />}
    </div>
  );
}
