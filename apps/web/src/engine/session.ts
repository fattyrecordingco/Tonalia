import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Layer } from '../types';
export interface Identity {
  sha256: string;
  frames: number;
  sampleRate: number;
  channels: number;
}
interface Snapshot {
  revision: number;
  identity: Identity;
  layers: Layer[];
  conflict: boolean;
}
interface Connection {
  endpoint: string;
  token: string;
  host: boolean;
  identity: Identity;
}
export function useSession(identity: Identity | null, apply: (layers: Layer[]) => void) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const connectionRef = useRef(connection),
    revisionRef = useRef(0),
    busyRef = useRef(false);
  const epoch = useRef(0),
    applyRef = useRef(apply),
    identityRef = useRef(identity);
  applyRef.current = apply;
  identityRef.current = identity;
  const conflict = useRef<Layer[] | null>(null);
  const [hasConflict, setHasConflict] = useState(false);
  const leave = useCallback(async () => {
    ++epoch.current;
    const old = connectionRef.current;
    connectionRef.current = null;
    setConnection(null);
    busyRef.current = false;
    setBusy(false);
    conflict.current = null;
    setHasConflict(false);
    if (old?.host) await invoke('stop_session');
    setStatus('Session disconnected. Current layers remain local.');
  }, []);
  useEffect(() => {
    if (connectionRef.current && identity?.sha256 !== connectionRef.current.identity.sha256)
      void leave();
  }, [identity?.sha256, leave]);
  useEffect(
    () => () => {
      if (connectionRef.current?.host) void invoke('stop_session');
    },
    [],
  );
  const receive = (snapshot: Snapshot) => {
    revisionRef.current = snapshot.revision;
    setRevision(snapshot.revision);
    applyRef.current(snapshot.layers);
  };
  const host = async (layers: Layer[], lan: boolean) => {
    if (!identityRef.current) throw new Error('Wait for the source fingerprint.');
    const result = await invoke<{ endpoint: string; token: string; snapshot: Snapshot }>(
      'host_session',
      { identity: identityRef.current, layers, lan },
    );
    const c = {
      endpoint: result.endpoint,
      token: result.token,
      host: true,
      identity: identityRef.current,
    };
    ++epoch.current;
    connectionRef.current = c;
    setConnection(c);
    receive(result.snapshot);
    setStatus(
      lan
        ? 'Hosting on this computer. Use its private LAN IP in the invite for other computers.'
        : 'Hosting on loopback. Only this computer can connect.',
    );
  };
  const join = async (invite: string) => {
    if (!identityRef.current)
      throw new Error('Open the identical WAV and wait for its fingerprint.');
    const parsed = JSON.parse(invite) as { endpoint: string; token: string };
    if (typeof parsed.endpoint !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.token))
      throw new Error('Invalid session invite.');
    const c = { ...parsed, host: false, identity: identityRef.current };
    const snapshot = await invoke<Snapshot>('exchange_session', {
      endpoint: c.endpoint,
      request: { token: c.token, identity: c.identity, baseRevision: null, layers: null },
    });
    ++epoch.current;
    connectionRef.current = c;
    setConnection(c);
    receive(snapshot);
    setStatus('Connected. Accepted revisions are synchronized every 750 ms.');
  };
  const submit = async (layers: Layer[]) => {
    const c = connectionRef.current;
    if (!c) return false;
    if (busyRef.current) {
      setStatus('Wait for the current edit to be acknowledged.');
      return true;
    }
    busyRef.current = true;
    setBusy(true);
    const own = epoch.current;
    try {
      const snapshot = await invoke<Snapshot>('exchange_session', {
        endpoint: c.endpoint,
        request: {
          token: c.token,
          identity: c.identity,
          baseRevision: revisionRef.current,
          layers,
        },
      });
      if (own !== epoch.current) return true;
      receive(snapshot);
      if (snapshot.conflict) {
        conflict.current = structuredClone(layers);
        setHasConflict(true);
        setStatus(
          'Another edit arrived first. The shared revision is loaded; download your rejected proposal before reconciling it manually.',
        );
      } else setStatus(`Revision ${snapshot.revision} accepted by host.`);
    } catch (e) {
      if (own === epoch.current) {
        conflict.current = structuredClone(layers);
        setHasConflict(true);
        setStatus(
          `Edit was not acknowledged: ${String(e)} Your proposal is available for download.`,
        );
      }
    } finally {
      if (own === epoch.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
    return true;
  };
  useEffect(() => {
    if (!connection) return;
    let active = true,
      polling = false;
    const timer = setInterval(async () => {
      if (!active || busyRef.current || polling) return;
      polling = true;
      const own = epoch.current;
      const base = revisionRef.current;
      try {
        const snapshot = await invoke<Snapshot>('exchange_session', {
          endpoint: connection.endpoint,
          request: {
            token: connection.token,
            identity: connection.identity,
            baseRevision: null,
            layers: null,
          },
        });
        if (
          active &&
          own === epoch.current &&
          !busyRef.current &&
          base === revisionRef.current &&
          snapshot.revision > revisionRef.current
        )
          receive(snapshot);
      } catch (e) {
        if (active && own === epoch.current) setStatus(String(e));
      } finally {
        polling = false;
      }
    }, 750);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connection]);
  return { connection, revision, status, busy, hasConflict, conflict, host, join, leave, submit };
}
