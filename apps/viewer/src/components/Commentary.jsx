import { memo } from 'react';
import { useCommentary } from '@cricket/client';
import { api, live } from '../lib/runtime.js';
import { Card } from './ui.jsx';

const KIND_STYLE = {
  four: 'bg-sky-600 text-white',
  six: 'bg-violet-600 text-white',
  wicket: 'bg-red-600 text-white',
  wide: 'bg-amber-100 text-amber-900',
  noball: 'bg-amber-100 text-amber-900',
  bye: 'bg-amber-100 text-amber-900',
  legbye: 'bg-amber-100 text-amber-900',
  dot: 'bg-slate-100 text-slate-500',
  runs: 'bg-white text-slate-900 ring-1 ring-slate-300',
};

// One row per delivery; memoised so a new ball renders one row, not the whole feed.
const Entry = memo(function Entry({ e }) {
  const strong = e.kind === 'four' || e.kind === 'six' || e.kind === 'wicket';
  return (
    <li className="rise border-t border-slate-100 first:border-0">
      {e.endOfOver && (
        <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
          <span>{e.endOfOver.text}</span>
        </div>
      )}
      <div className="flex gap-3 px-4 py-3">
        <div className="flex w-11 shrink-0 flex-col items-center gap-1">
          <span className="tnum text-xs font-semibold text-slate-500">{e.over}</span>
          <span className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tnum ${KIND_STYLE[e.kind] || KIND_STYLE.runs}`}>
            {e.label === '0' ? '•' : e.label}
          </span>
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <p className={strong ? 'font-semibold text-slate-900' : 'text-slate-800'}>{e.text}</p>
          {e.milestones?.map((m) => <p key={m} className="mt-1 text-xs font-semibold text-brand">{m}</p>)}
          <p className="mt-0.5 text-xs text-slate-500">{e.scoreText}</p>
        </div>
      </div>
    </li>
  );
});

/** Ball-by-ball commentary: loads the latest page, then appends every delivery as it happens. */
export default function CommentaryFeed({ matchId, limit = 30, title = 'Commentary' }) {
  const { entries } = useCommentary({ api, live, matchId, limit });
  if (!entries) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] uppercase tracking-wide text-slate-500">every ball</span>
      </div>
      {entries.length ? (
        <ol data-testid="commentary">{entries.map((e) => <Entry key={e.seq} e={e} />)}</ol>
      ) : <p className="px-4 py-6 text-center text-sm text-slate-500">Commentary starts with the first ball.</p>}
    </Card>
  );
}
