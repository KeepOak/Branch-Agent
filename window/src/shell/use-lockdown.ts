import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../connect/engine";
import type { SaplingSession } from "../connect/session";
import { configStore } from "../places/settings/config-store";
import { notify } from "./notify";
import { ConfirmLockdown } from "./ConfirmLockdown";

export function useLockdown(engine: WindowEngine, ready: boolean, session?: SaplingSession) {
  const store = configStore(engine);
  const [supported, setSupported] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
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
  const save = useCallback(async (next: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      await store.set("security.lockdown", next);
      notify(next ? "Lockdown is on." : "Lockdown is off.");
      setConfirming(false);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [store]);
  const toggle = useCallback(() => {
    if (!supported) return Promise.reject(new Error("This engine has no Lockdown switch yet."));
    if (!snapshot || busy.current) return Promise.resolve();
    if (on) return save(false);
    setConfirming(true);
    return Promise.resolve();
  }, [snapshot, on, supported, save]);
  const confirmation = confirming ? createElement(ConfirmLockdown, {
    busy: saving,
    onCancel: () => { if (!busy.current) setConfirming(false); },
    onConfirm: () => {
      if (!supported || !ready) { setConfirming(false); return; }
      void save(true).catch((error: unknown) => notify(`Couldn't change Lockdown: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
    },
  }) : null;
  return { on, toggle, confirmation, loaded: Boolean(snapshot), supported, error: store.error };
}
