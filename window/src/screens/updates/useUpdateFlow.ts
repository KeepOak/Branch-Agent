// The calls behind the R1 update button and banner (HANDOFF R1-11 "Engine calls"). Desktop: componentUpdates.status()
// through useDesktopComponentStatus, stage() then install(), outcomes on the branch:update-state window event.
// Elsewhere: update.status, update.run, refreshed on the engine's "update" event.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { friendlyError } from "../../connect/friendly-error";
import { componentDesktop, ENGINE_UPDATE_EVENT, useDesktopComponentStatus, type EngineUpdateEvent } from "../../connect/desktop-component-updates";
import { desktopUpdateView, engineUpdateView, type UpdateView } from "./model";

/** How long "Updated to X" stays before the button leaves. */
export const DONE_MS = 4000;
/** While an engine-side run is active the status is re-read this often; idle, the engine's "update" event drives it. */
const RUN_POLL_MS = 5000;
const message = (error: unknown) => friendlyError(error);

/** `need` is the engine call `act` makes (R1-10): update.run when the engine updates itself, null when the desktop app's
 *  own updater does it (a local call). `engine` is what the button checks `need` against. */
export type UpdateFlow = { view: UpdateView; act: () => void; need: string | null; engine: Pick<WindowEngine, "features"> };

export function useUpdateFlow(engine: Pick<WindowEngine, "request" | "onEvent" | "gatewayUrl"> & Partial<Pick<WindowEngine, "features">>, ready: boolean, current: string, openSettings?: () => void): UpdateFlow {
  const desktop = componentDesktop(engine.gatewayUrl);
  const bridge = desktop?.componentUpdates;
  const native = useDesktopComponentStatus(engine.gatewayUrl);
  const nativeRef = useRef(native); nativeRef.current = native;
  const [bar, setBar] = useState<EngineUpdateEvent | null>(null);
  const [staging, setStaging] = useState(false), [restartRequested, setRestartRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<unknown>(null), [started, setStarted] = useState(false), [doneVersion, setDoneVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) return;
    const onState = (event: Event) => { const detail = (event as CustomEvent<EngineUpdateEvent>).detail; setBar(detail); if (detail?.state !== "preparing" && detail?.state !== "updating" && detail?.state !== "restarting") setRestartRequested(false); };
    window.addEventListener(ENGINE_UPDATE_EVENT, onState);
    return () => window.removeEventListener(ENGINE_UPDATE_EVENT, onState);
  }, [desktop]);
  // An outcome changes what is installed: re-read it now rather than at the next 15 s status read.
  const outcome = bar?.state === "updated" || bar?.state === "kept" || bar?.state === "failed" ? bar.state : null;
  useEffect(() => {
    if (!outcome || !bridge) return;
    let live = true;
    void bridge.status().then(next => { if (live) nativeRef.current.setStatus(next); }, () => undefined);
    return () => { live = false; };
  }, [outcome, bridge]);

  const reload = useCallback(() => engine.request("update.status", {}).then(setGateway, (e: unknown) => setError(message(e))), [engine]);
  useEffect(() => {
    if (desktop || !ready) return;
    void reload();
    return engine.onEvent(({ event }) => { if (event === "update") void reload(); });
  }, [desktop, ready, engine, reload]);
  const view: UpdateView = desktop
    ? desktopUpdateView({ status: native.status, current: native.status?.currentVersion ?? current, bar, staging, restartRequested, canRestart: Boolean(bridge?.install), error: error ?? (native.status?.phase === "error" && native.error ? friendlyError(native.error) : null) })
    : ready ? engineUpdateView({ status: gateway, current, started, error, doneVersion }) : { kind: "none" };
  const running = !desktop && view.kind === "installing";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void engine.request<{ activeRun?: unknown; lastRun?: { status?: unknown; target?: { version?: unknown } } }>("update.status", {}).then(next => {
        setGateway(next);
        const last = next?.lastRun, version = last?.target?.version;
        if (!next?.activeRun) { setStarted(false); if (last?.status === "succeeded" && typeof version === "string" && version) setDoneVersion(version); }
      }, () => undefined);
    }, RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, engine]);
  const done = view.kind === "done";
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => { setBar(null); setDoneVersion(null); setRestartRequested(false); }, DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const act = () => {
    setError(null);
    if (desktop) {
      if (!bridge) { openSettings?.(); return; }
      const staged = native.status?.phase === "staged";
      if (staged) {
        if (!bridge.install) { openSettings?.(); return; }
        setBar(null); setRestartRequested(true); bridge.install(); return;
      }
      setStaging(true);
      void bridge.stage().then(next => { native.setStatus(next); if (next.error) setError(friendlyError(next.error)); }, (e: unknown) => setError(message(e))).finally(() => setStaging(false));
      return;
    }
    setStarted(true);
    void engine.request<Record<string, unknown>>("update.run", {}).then(result => {
      if (result?.ok !== true) throw new Error(typeof result?.message === "string" && result.message ? result.message : "The engine didn’t start the update.");
      return reload();
    }).catch((e: unknown) => { setStarted(false); setError(message(e)); });
  };
  return { view, act, need: desktop ? null : "update.run", engine };
}
