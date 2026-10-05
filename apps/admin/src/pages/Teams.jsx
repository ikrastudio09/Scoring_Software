import { useState } from 'react';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../components/ui.jsx';

const ROLES = [['batter', 'Batter'], ['bowler', 'Bowler'], ['allrounder', 'All-rounder'], ['wicketkeeper', 'Wicket-keeper']];

function TeamForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState(null);
  const save = async () => {
    const body = { name: f.name, shortName: f.shortName, color: f.color, group: f.group || undefined, logoUrl: f.logoUrl || undefined, homeGround: f.homeGround || undefined };
    try {
      if (f.id) await api.put(`/teams/${f.id}`, body); else await api.post('/teams', body);
      toast('Team saved', 'success');
      onSaved();
      onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit team' : 'New team'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.name || !f.shortName}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Short name (≤5)"><Input maxLength={5} value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value.toUpperCase() })} /></Field>
        <Field label="Colour"><Input type="color" value={f.color || '#334155'} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
        <Field label="Group (optional)"><Input value={f.group || ''} onChange={(e) => setF({ ...f, group: e.target.value })} /></Field>
        <Field label="Logo URL (optional)" className="sm:col-span-2"><Input value={f.logoUrl || ''} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://… or /logos/team.png" /></Field>
        <Field label="Home ground (optional)" className="sm:col-span-2"><Input value={f.homeGround || ''} onChange={(e) => setF({ ...f, homeGround: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function PlayerForm({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(initial);
  const [err, setErr] = useState(null);
  const save = async () => {
    const body = {
      name: f.name, team: f.team, role: f.role, battingStyle: f.battingStyle, bowlingStyle: f.bowlingStyle || undefined,
      jerseyNumber: f.jerseyNumber === '' || f.jerseyNumber === undefined ? null : Number(f.jerseyNumber), active: f.active !== false,
    };
    try {
      if (f.id) await api.put(`/players/${f.id}`, body); else await api.post('/players', body);
      toast('Player saved', 'success');
      onSaved();
      onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? 'Edit player' : 'New player'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.name}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Jersey #"><Input type="number" value={f.jerseyNumber ?? ''} onChange={(e) => setF({ ...f, jerseyNumber: e.target.value })} /></Field>
        <Field label="Bats"><Select value={f.battingStyle} onChange={(e) => setF({ ...f, battingStyle: e.target.value })}><option value="right">Right-hand</option><option value="left">Left-hand</option></Select></Field>
        <Field label="Bowling style"><Input value={f.bowlingStyle || ''} onChange={(e) => setF({ ...f, bowlingStyle: e.target.value })} placeholder="Right-arm medium" /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (selectable for XIs)</label>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Squad({ team, isAdmin }) {
  const toast = useToast();
  const { data, reload } = useApi(api, `/teams/${team.id}`, [team.id]);
  const [form, setForm] = useState(null);
  if (!data) return <Spinner />;
  const del = async (p) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try { await api.del(`/players/${p.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <div className="divide-y divide-slate-100">
        {data.team.squad.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${p.active === false ? 'opacity-50' : ''}`}>
            <span className="w-8 text-xs text-slate-400 tnum">{p.jerseyNumber ?? ''}</span>
            <span className="flex-1 font-medium">{p.name}</span>
            <span className="text-xs text-slate-500">{ROLES.find((r) => r[0] === p.role)?.[1]}</span>
            {isAdmin && <Button variant="ghost" size="px-2 py-1 text-xs" onClick={() => setForm(p)}>Edit</Button>}
            {isAdmin && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => del(p)}>Delete</Button>}
          </div>
        ))}
      </div>
      {isAdmin && <div className="p-3"><Button variant="secondary" size="px-3 py-1.5 text-sm" onClick={() => setForm({ name: '', team: team.id, role: 'batter', battingStyle: 'right' })}>+ Add player</Button></div>}
      {form && <PlayerForm initial={{ ...form, team: team.id }} onClose={() => setForm(null)} onSaved={reload} />}
    </div>
  );
}

export default function Teams() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi(api, '/teams');
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const del = async (t) => {
    if (!window.confirm(`Delete ${t.name}?`)) return;
    try { await api.del(`/teams/${t.id}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <PageHeader title={`Teams (${data.teams.length})`}>{isAdmin && <Button onClick={() => setForm({ name: '', shortName: '', color: '#334155' })}>New team</Button>}</PageHeader>
      <div className="space-y-2">
        {data.teams.map((t) => (
          <Card key={t.id} className="overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="h-4 w-4 rounded-full" style={{ background: t.color }} />
              <button type="button" className="flex-1 text-left font-semibold" onClick={() => setOpen(open === t.id ? null : t.id)}>
                {t.name} <span className="text-sm font-normal text-slate-500">· {t.shortName} · {t.players} players{t.group ? ` · Group ${t.group}` : ''}</span>
              </button>
              {isAdmin && <Button variant="ghost" size="px-2 py-1 text-xs" onClick={() => setForm(t)}>Edit</Button>}
              {isAdmin && <Button variant="ghost" size="px-2 py-1 text-xs" className="text-red-600" onClick={() => del(t)}>Delete</Button>}
              <span className="text-slate-400">{open === t.id ? '▾' : '▸'}</span>
            </div>
            {open === t.id && <div className="border-t border-slate-100"><Squad team={t} isAdmin={isAdmin} /></div>}
          </Card>
        ))}
      </div>
      {form && <TeamForm initial={form} onClose={() => setForm(null)} onSaved={reload} />}
    </div>
  );
}
