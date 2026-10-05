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
