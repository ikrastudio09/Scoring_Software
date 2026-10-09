import { Link } from 'react-router';

export function Card({ className = '', children, ...rest }) {
  return <div className={`rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`} {...rest}>{children}</div>;
}

export function SectionTitle({ children, action }) {
  return (
    <div className="mb-3 mt-6 flex items-center justify-between first:mt-0">
      <h2 className="text-base font-semibold tracking-tight text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

const STATUS_STYLE = {
  LIVE: 'bg-red-600 text-white',
  SECOND_INNINGS: 'bg-red-600 text-white',
  INNINGS_BREAK: 'bg-amber-500 text-white',
  READY: 'bg-sky-100 text-sky-800',
  SCHEDULED: 'bg-slate-100 text-slate-700',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  POSTPONED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-slate-200 text-slate-600',
  ABANDONED: 'bg-slate-200 text-slate-600',
};
const STATUS_LABEL = {
  LIVE: 'Live', SECOND_INNINGS: 'Live', INNINGS_BREAK: 'Innings break', READY: 'Toss done', SCHEDULED: 'Upcoming',
  COMPLETED: 'Result', POSTPONED: 'Postponed', CANCELLED: 'Cancelled', ABANDONED: 'Abandoned',
};

export function StatusBadge({ status }) {
  const live = status === 'LIVE' || status === 'SECOND_INNINGS';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] || STATUS_STYLE.SCHEDULED}`}>
      {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function TeamDot({ color, size = 'h-3 w-3' }) {
  return <span className={`inline-block shrink-0 rounded-full ${size}`} style={{ background: color || '#94a3b8' }} />;
}

export function TeamLogo({ team, size = 'h-9 w-9 text-xs' }) {
  if (team?.logoUrl) return <img src={team.logoUrl} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  return (
    <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`} style={{ background: team?.color || '#64748b' }}>
      {(team?.shortName || '?').slice(0, 3)}
    </span>
  );
}

const BALL_STYLE = (label) => {
  if (label.includes('W') && !label.includes('Wd')) return 'bg-red-600 text-white';
  if (label === '4') return 'bg-sky-600 text-white';
  if (label === '6') return 'bg-violet-600 text-white';
  if (/Wd|Nb|B|LB/.test(label)) return 'bg-amber-100 text-amber-900 ring-1 ring-amber-300';
  if (label === '0') return 'bg-slate-100 text-slate-500';
  return 'bg-white text-slate-900 ring-1 ring-slate-300';
};

const BALL_STYLE_DARK = (label) => {
  if (label === '0') return 'bg-white/10 text-white/60';
  if (/^[1-35-7]$/.test(label)) return 'bg-white text-slate-950';
  return BALL_STYLE(label);
};

export function BallChip({ label, size = 'h-8 min-w-8 text-xs', dark = false }) {
  return <span className={`inline-flex items-center justify-center rounded-full px-1.5 font-semibold tnum ${size} ${dark ? BALL_STYLE_DARK(label) : BALL_STYLE(label)}`}>{label === '0' ? '•' : label}</span>;
}

/** Player photo with the team colour as fallback (initials). */
export function Avatar({ name, photoUrl, color, size = 'h-10 w-10 text-xs' }) {
  if (photoUrl) return <img src={photoUrl} alt="" loading="lazy" className={`${size} shrink-0 rounded-full bg-slate-200 object-cover`} />;
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span className={`${size} inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white`} style={{ background: color || '#64748b' }}>{initials}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Card className="p-6 text-center">
      <p className="font-medium text-slate-900">{error?.isNetwork ? 'You appear to be offline' : 'Something went wrong'}</p>
      <p className="mt-1 text-sm text-slate-500">{error?.message}</p>
      {onRetry && <button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Try again</button>}
    </Card>
  );
}

export function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-200/70 p-1" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === t.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PlayerLink({ id, children, className = '' }) {
  return <Link to={`/players/${id}`} className={`hover:text-brand hover:underline ${className}`}>{children}</Link>;
}
