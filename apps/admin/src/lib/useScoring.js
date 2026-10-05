// Scorer command pipeline.
//
// Guarantees:
//  * one command in flight at a time (double taps are ignored locally, and rejected by the
//    server's expectedVersion check if they ever get through);
//  * a command whose outcome is unknown (network error, timeout, 5xx) is persisted and retried
//    with the SAME clientEventId until the server answers — the server either records it once
//    or reports it as a duplicate, so a retry can never create a second ball;
//  * nothing else can be recorded while a command is unconfirmed, so order is preserved even if
//    the laptop crashes and the page is reopened (the persisted command is retried on load).

import { useCallback, useEffect, useRef, useState } from 'react';
import { newEventId } from '@cricket/client';
import { api } from './runtime.js';

const key = (matchId) => `cricket.outbox.${matchId}`;
const load = (matchId) => { try { return JSON.parse(localStorage.getItem(key(matchId))); } catch { return null; } };
const save = (matchId, cmd) => { try { if (cmd) localStorage.setItem(key(matchId), JSON.stringify(cmd)); else localStorage.removeItem(key(matchId)); } catch { /* ignore */ } };
const isUnknownOutcome = (err) => err.status === 0 || err.status >= 500;

export function useScoring({ matchId, version, apply, toast }) {
  const [pending, setPending] = useState(null); // command currently being sent
  const [unsent, setUnsent] = useState(() => load(matchId)); // command awaiting confirmation
  const busy = useRef(false);
  const retryTimer = useRef(null);
  const attempts = useRef(0);

  const attempt = useCallback(async (cmd) => {
    busy.current = true;
    setPending(cmd);
    try {
      const res = await api.post(`/matches/${matchId}/${cmd.path}`, cmd.body, { timeoutMs: 8000 });
      save(matchId, null);
      setUnsent(null);
      attempts.current = 0;
      apply(res.view);
      if (res.duplicate) toast('Already recorded — no duplicate created', 'info');
      return res;
    } catch (err) {
      if (isUnknownOutcome(err)) {
        // Outcome unknown: keep it and retry with the same id.
        setUnsent(cmd);
        attempts.current += 1;
        const delay = Math.min(1000 * 2 ** (attempts.current - 1), 8000);
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => { if (!busy.current) attempt(cmd); }, delay);
        return null;
      }
      // Definitive rejection: nothing was recorded.
      save(matchId, null);
      setUnsent(null);
      attempts.current = 0;
      if (err.details?.view) apply(err.details.view);
      toast(err.message, 'error', 5000);
      return null;
    } finally {
      busy.current = false;
      setPending(null);
    }
  }, [matchId, apply, toast]);

  // Reopened after a crash with an unconfirmed command: resolve it before anything else.
  useEffect(() => {
    const stored = load(matchId);
    if (stored) attempt(stored);
    return () => clearTimeout(retryTimer.current);
  }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((path, body, label) => {
    if (busy.current || unsent || version === null || version === undefined) return null;
    const cmd = { path, label, body: { ...body, clientEventId: newEventId(), expectedVersion: version }, at: Date.now() };
    save(matchId, cmd);
    return attempt(cmd);
  }, [matchId, version, unsent, attempt]);

  const retryNow = useCallback(() => {
    if (unsent && !busy.current) { clearTimeout(retryTimer.current); attempt(unsent); }
  }, [unsent, attempt]);

  return { send, pending, unsent, retryNow, locked: Boolean(pending || unsent) };
}
