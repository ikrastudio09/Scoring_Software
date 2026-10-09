import { Card } from './ui.jsx';

/**
 * Bonus-point tracker. The server lists only conditions that can still be met (`live`) or were
 * met (`achieved`), so it disappears by itself once no bonus is possible.
 */
export default function BonusPoint({ bonus }) {
  if (!bonus?.conditions?.length) return null;
  const awarded = bonus.conditions.find((c) => c.status === 'achieved');
  const pts = `${bonus.points} bonus point${bonus.points === 1 ? '' : 's'}`;
  return (
    <Card className={`p-4 ${awarded ? 'ring-emerald-300' : ''}`}>
      <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${awarded ? 'bg-emerald-600' : 'bg-amber-500'}`}>+{bonus.points}</span>
        {awarded ? `${pts} earned` : `${pts} still available`}
      </p>
      <ul className="space-y-1.5 text-sm text-slate-700">
        {bonus.conditions.map((c) => (
          <li key={c.kind} className="flex gap-2">
            <span className={c.status === 'achieved' ? 'text-emerald-600' : 'text-amber-500'}>{c.status === 'achieved' ? '✓' : '●'}</span>
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
