import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useApi } from '@cricket/client';
import { api } from '../lib/runtime.js';
import { Button, Card, ErrorBox, Field, PageHeader, Select, Spinner, useToast } from '../components/ui.jsx';

function XiPicker({ team, squad, selected, onChange, max }) {
  const toggle = (id) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{team.name} XI</h2>
        <span className={`text-sm tnum ${selected.length > max || selected.length < 2 ? 'text-red-600' : 'text-slate-500'}`}>{selected.length}/{max}</span>
      </div>
      <p className="mb-2 text-xs text-slate-500">Tick players in batting order (the order you tick them is the order shown to the scorer).</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {squad.filter((p) => p.active !== false).map((p) => {
          const idx = selected.indexOf(p.id);
          return (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ring-1 ${idx >= 0 ? 'bg-teal-50 ring-teal-300' : 'ring-slate-200 hover:bg-slate-50'}`}>
              <input type="checkbox" checked={idx >= 0} onChange={() => toggle(p.id)} />
              <span className="w-5 text-xs text-slate-500 tnum">{idx >= 0 ? idx + 1 : ''}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[10px] uppercase text-slate-400">{p.role === 'wicketkeeper' ? 'wk' : p.role.slice(0, 4)}</span>
            </label>
          );
        })}
      </div>
    </Card>
  );
}

export default function MatchSetup() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi(api, `/matches/${id}`, [id]);
  const t = useApi(api, '/tournament');
  const m = data?.match;
  const squadA = useApi(api, m?.teamA?.id ? `/teams/${m.teamA.id}` : null, [m?.teamA?.id]);
  const squadB = useApi(api, m?.teamB?.id ? `/teams/${m.teamB.id}` : null, [m?.teamB?.id]);
  const [toss, setToss] = useState({ winner: '', decision: 'bat' });
  const [xiA, setXiA] = useState([]);
  const [xiB, setXiB] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const max = t.data?.tournament.rules.playersPerSide || 11;

  useEffect(() => {
    if (!m) return;
    if (m.toss) setToss(m.toss);
    if (m.playingXI.teamA.length) setXiA(m.playingXI.teamA.map((p) => p.id));
    if (m.playingXI.teamB.length) setXiB(m.playingXI.teamB.map((p) => p.id));
  }, [m]);

  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!m || !squadA.data || !squadB.data) return <Spinner />;
  if (!m.teamA?.id || !m.teamB?.id) return <Card className="p-6">Assign both teams to this fixture first (Fixtures page).</Card>;
  if (!['SCHEDULED', 'READY'].includes(m.status)) {
    return <Card className="p-6">Setup is locked once scoring has started. <Link className="text-teal-700 underline" to={`/matches/${id}/score`}>Go to scoring</Link></Card>;
  }

  const valid = toss.winner && xiA.length >= 2 && xiB.length >= 2 && xiA.length <= max && xiB.length <= max;
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/matches/${id}/setup`, { toss, playingXI: { teamA: xiA, teamB: xiB } });
      toast('Match ready', 'success');
      nav(`/matches/${id}/score`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Match ${m.number}: ${m.teamA.name} v ${m.teamB.name} — setup`} />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Toss won by">
          <Select value={toss.winner} onChange={(e) => setToss({ ...toss, winner: e.target.value })}>
            <option value="">Select…</option><option value={m.teamA.id}>{m.teamA.name}</option><option value={m.teamB.id}>{m.teamB.name}</option>
          </Select>
        </Field>
        <Field label="Elected to">
          <Select value={toss.decision} onChange={(e) => setToss({ ...toss, decision: e.target.value })}><option value="bat">Bat</option><option value="bowl">Bowl</option></Select>
        </Field>
        <div className="text-sm text-slate-600 sm:pt-6">{m.rules.oversPerInnings} overs · max {m.rules.maxOversPerBowler} per bowler · {m.rules.freeHit ? 'free hit on' : 'no free hit'}</div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <XiPicker team={m.teamA} squad={squadA.data.team.squad} selected={xiA} onChange={setXiA} max={max} />
        <XiPicker team={m.teamB} squad={squadB.data.team.squad} selected={xiB} onChange={setXiB} max={max} />
      </div>
      <div className="mt-4 space-y-2">
        <ErrorBox error={err} />
        <Button size="px-6 py-3 text-base" disabled={!valid || busy} onClick={save}>Save and go to scoring</Button>
      </div>
    </div>
  );
}
