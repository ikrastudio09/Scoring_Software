import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useConnectionStatus } from '@cricket/client';
import { live } from '../lib/runtime.js';

const VARIANTS = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50',
  secondary: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100',
  dark: 'bg-slate-900 text-white hover:bg-slate-800',
};

export function Button({ variant = 'primary', className = '', size = 'px-4 py-2 text-sm', ...rest }) {
  return <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${size} ${className}`} {...rest} />;
}

export function Card({ className = '', ...rest }) {
  return <div className={`rounded-xl bg-white shadow-sm ring-1 ring-slate-200 ${className}`} {...rest} />;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 disabled:bg-slate-100';
export const Input = (props) => <input className={inputCls} {...props} />;
export const Select = ({ children, ...props }) => <select className={inputCls} {...props}>{children}</select>;
export const Textarea = (props) => <textarea className={inputCls} rows={3} {...props} />;

export function Modal({ open, title, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const id = useRef(0);
  const push = useCallback((message, kind = 'info', ms = 3500) => {
    const t = { id: ++id.current, message, kind };
    setToasts((x) => [...x.slice(-3), t]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== t.id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-3" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto max-w-lg rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function ConnectionPill() {
  const status = useConnectionStatus(live);
  const style = status === 'connected' ? 'bg-emerald-100 text-emerald-800' : status === 'offline' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800';
  const label = status === 'connected' ? 'Live' : status === 'offline' ? 'Offline' : 'Reconnecting';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${style}`} title="Realtime connection">
      <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-emerald-500' : status === 'offline' ? 'bg-red-500' : 'animate-pulse bg-amber-500'}`} />
      {label}
    </span>
  );
}

const STATUS = {
  SCHEDULED: 'bg-slate-100 text-slate-700', READY: 'bg-sky-100 text-sky-800', LIVE: 'bg-red-600 text-white', SECOND_INNINGS: 'bg-red-600 text-white',
  INNINGS_BREAK: 'bg-amber-500 text-white', COMPLETED: 'bg-emerald-100 text-emerald-800', POSTPONED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-slate-200 text-slate-600', ABANDONED: 'bg-slate-200 text-slate-600',
};
export function StatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS[status] || STATUS.SCHEDULED}`}>{status?.replace('_', ' ')}</span>;
}

export function Spinner() {
  return <div className="flex justify-center py-12"><span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-teal-700" /></div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
      {error.message}
      {onRetry && <button type="button" className="ml-2 font-semibold underline" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

const BALL = (l) => (l.includes('W') && !l.includes('Wd') ? 'bg-red-600 text-white' : l === '4' ? 'bg-sky-600 text-white' : l === '6' ? 'bg-violet-600 text-white'
  : /Wd|Nb|B|LB/.test(l) ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-300' : l === '0' ? 'bg-slate-100 text-slate-500' : 'bg-white ring-1 ring-slate-300');
export function Ball({ label }) {
  return <span className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-xs font-bold tnum ${BALL(label)}`}>{label === '0' ? '•' : label}</span>;
}

export const fmtDateTime = (d) => (d ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d)) : 'Date TBC');
export const toLocalInput = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
