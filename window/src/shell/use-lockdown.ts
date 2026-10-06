import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../connect/engine";
import type { SaplingSession } from "../connect/session";
import { configStore } from "../places/settings/config-store";

export function useLockdown(engine: WindowEngine, ready: boolean, session?: SaplingSession) {
  const store = configStore(engine);
  const [supported, setSupported] = useState(false);
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.snap,
    () => store.snap,
  );
  useEffect(() => {
    if (ready && !snapshot) void store.load();
  }, [ready, snapshot, store]);
  useEffect(() => session?.onGatewayEvent((event) => {
    if (event === "config.changed") void store.load();
  }), [session, store]);
  useEffect(() => {
    if (!ready) { setSupported(false); return; }
    let current = true;
    engine.request("config.schema.lookup", { path: "security.lockdown" }).then(
      () => { if (current) setSupported(true); },
      () => { if (current) setSupported(false); },
    );
    return () => { current = false; };
  }, [engine, ready]);
  const on = (snapshot?.config as { security?: { lockdown?: boolean } } | undefined)?.security?.lockdown === true;
  const toggle = useCallback(() => supported ? store.set("security.lockdown", !on) : Promise.reject(new Error("This engine has no Lockdown switch yet.")), [store, on, supported]);
  return { on, toggle, loaded: Boolean(snapshot), supported, error: store.error };
}
