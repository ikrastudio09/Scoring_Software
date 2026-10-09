import { useCallback, useEffect, useRef, useState } from 'react';
import { isNewer } from './live.js';

const pickLive = (d) => d.live;

export function useConnectionStatus(live) {
  const [status, setStatus] = useState(live.status);
  useEffect(() => live.onStatus(setStatus), [live]);
  return status;
}

/**
 * Live match state with REST bootstrap + socket updates + version guard.
 * Returns { live, error, status, lastEnvelope, apply } where `apply` lets the scorer console feed
 * in the authoritative view returned by its own REST command (no waiting for the socket).
 */
export function useLiveMatch({ api, live: conn, matchId, channel = 'viewer', path = 'live', pick = pickLive }) {
  const [state, setState] = useState({ live: null, version: null, envelope: null });
  const [error, setError] = useState(null);
  const versionRef = useRef(null);
  const status = useConnectionStatus(conn);

  const apply = useCallback((view, envelope = null) => {
    if (!view) return;
    const incoming = envelope || { version: view.version, type: 'MATCH_STATE_UPDATED' };
    if (!isNewer(incoming, versionRef.current)) return;
    versionRef.current = incoming.version;
    setState({ live: view, version: incoming.version, envelope });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get(`/matches/${matchId}/${path}`);
      apply(pick(data));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [api, matchId, path, apply, pick]);

  useEffect(() => {
    if (!matchId) return undefined;
    versionRef.current = null;
    setState({ live: null, version: null, envelope: null });
    refresh();
    return conn.subscribe(matchId, channel, (env) => apply(env.live, env));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, channel, conn]);

  // Belt and braces: after a reconnect also re-fetch over REST.
  const prev = useRef(status);
  useEffect(() => {
    if (prev.current !== 'connected' && status === 'connected' && versionRef.current !== null) refresh();
    prev.current = status;
  }, [status, refresh]);

  return { live: state.live, version: state.version, lastEnvelope: state.envelope, error, status, apply, refresh };
}

/** Simple data loader with refetch. */
export function useApi(api, path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api.get(path));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/**
 * Ball-by-ball commentary, newest first. One REST page on open, then each new delivery arrives in
 * the `ball` block of the socket envelope. A gap in versions (missed message, reconnect) or an
 * undo triggers a REST refetch — the feed is never rebuilt by replaying the match.
 */
export function useCommentary({ api, live: conn, matchId, channel = 'viewer', limit = 30 }) {
  const [entries, setEntries] = useState(null);
  const versionRef = useRef(null); // version the list reflects
  const seenRef = useRef(0); // highest version seen on the socket
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!matchId || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const d = await api.get(`/matches/${matchId}/commentary?limit=${limit}`);
      versionRef.current = d.version;
      setEntries(d.entries);
    } catch { /* keep what we have; the next event retries */ } finally {
      loadingRef.current = false;
    }
    if (seenRef.current > (versionRef.current ?? 0)) load();
  }, [api, matchId, limit]);

  useEffect(() => {
    if (!matchId) return undefined;
    versionRef.current = null;
    seenRef.current = 0;
    setEntries(null);
    load();
    return conn.subscribe(matchId, channel, (env) => {
      if (env.type === 'COMMENTARY_UPDATED') {
        setEntries((list) => list && list.map((e) => (e.seq === env.entry.seq ? env.entry : e)));
        return;
      }
      seenRef.current = Math.max(seenRef.current, env.version);
      const v = versionRef.current;
      if (v === null || env.version <= v) return; // not loaded yet (load re-checks) or stale
      if (env.version !== v + 1 || env.effects?.includes('UNDO')) { load(); return; }
      versionRef.current = env.version;
      if (env.ball) {
        const entry = { milestones: [], edited: false, ...env.ball };
        setEntries((list) => [entry, ...(list || []).filter((e) => e.seq !== entry.seq)].slice(0, limit * 3));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, channel, conn]);

  return { entries, reload: load, setEntries };
}
