// The live facts behind the status bar (DESIGN-SPEC §4.9.1): the gateway's health, what each connection has left,
// and whether a new version waits. Each refreshes on the engine's own events, never on a made-up timer result.
import { useEffect, useState } from "react";
import type { SaplingSession } from "../connect/session";
import { readLimits, readUpdate, type Limits, type UpdateInfo } from "./status-data";
import { componentDesktop, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus } from "../connect/desktop-component-updates";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export type Health = { ok: boolean; durationMs: number | null; checkedAt: number };
export type GatewayFacts = { health: Health | null; error: string | null; uptimeMs: number | null; connectedAt: number };

function readHealth(result: unknown): Health {
  const r = rec(result);
  return { ok: r.ok === true, durationMs: typeof r.durationMs === "number" ? r.durationMs : null, checkedAt: typeof r.ts === "number" ? r.ts : Date.now() };
}

/** health (on connect and on each "health" event) and hello's snapshot.uptimeMs. */
export function useGatewayFacts(session: SaplingSession, ready: boolean): GatewayFacts {
  const [facts, setFacts] = useState<GatewayFacts>({ health: null, error: null, uptimeMs: null, connectedAt: Date.now() });
  useEffect(() => {
    if (!ready) {
      setFacts((f) => ({ ...f, health: null }));
      return;
    }
    const status = session.getSnapshot().status;
    const snapshot = status.phase === "connected" ? rec(rec(status.hello).snapshot) : {};
    const uptimeMs = typeof snapshot.uptimeMs === "number" ? snapshot.uptimeMs : null;
    setFacts({ health: null, error: null, uptimeMs, connectedAt: Date.now() });
    const load = () =>
      session.request("health", { probe: false }).then(
        (r) => setFacts((f) => ({ ...f, health: readHealth(r), error: null })),
        (error: unknown) => setFacts((f) => ({ ...f, error: error instanceof Error ? error.message : String(error) })),
      );
    void load();
    return session.onGatewayEvent((event, payload) => {
      if (event === "health") {
        setFacts((f) => ({ ...f, health: readHealth(payload) }));
      }
    });
  }, [session, ready]);
  return facts;
}

/** usage.status, read on connect and every five minutes while connected (the Control UI's usage refresh cadence). */
export function useLimits(session: SaplingSession, ready: boolean): Limits | null {
  const [limits, setLimits] = useState<Limits | null>(null);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const load = () =>
      session.request("usage.status", {}).then(
        (r) => setLimits(readLimits(r)),
        (error: unknown) => console.warn("usage.status failed", error),
      );
    void load();
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, [session, ready]);
  return limits;
}

/** update.status on connect and on the engine's update events; hello's updateAvailable until it answers. */
export function useUpdate(session: SaplingSession, ready: boolean, version: string): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const desktop = componentDesktop(session.gatewayUrl);
  const native = useDesktopComponentStatus(session.gatewayUrl);
  const isDesktop = Boolean(desktop);
  useEffect(() => {
    if (!ready || isDesktop) {
      return;
    }
    const status = session.getSnapshot().status;
    const snapshot = status.phase === "connected" ? rec(rec(status.hello).snapshot) : {};
    setInfo(readUpdate({ updateAvailable: snapshot.updateAvailable ?? null }, version));
    const load = () =>
      session.request("update.status", {}).then(
        (r) => setInfo(readUpdate(r, version)),
        (error: unknown) => console.warn("update.status failed", error),
      );
    void load();
    return session.onGatewayEvent((event) => {
      if (event === "update.available" || event === "update.run.changed") {
        void load();
      }
    });
  }, [session, ready, version, isDesktop]);
  if (desktop) {
    const status = native.status;
    const available = status?.phase === "available" || status?.phase === "staged";
    return { current: status?.currentVersion ?? version, latest: available ? status.latestVersion : null, notes: [],
      installing: status?.phase === "staging" || status?.phase === "staged", waiting: status?.phase === "staged" ? "Downloaded. Restart Branch when your work is ready." : "Downloading and checking the update.",
      statusMessage: !desktop.componentUpdates ? desktop.unavailableReason ?? MANUAL_UPDATE_UNSUPPORTED : native.error ??
        (status?.phase === "current" ? undefined : "Check for updates in Updates & about.") };
  }
  return info;
}
