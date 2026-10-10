// The live facts behind the status bar (DESIGN-SPEC §4.9.1): the gateway's health, what each connection has left,
// and whether a new version waits. Each refreshes on the engine's own events, never on a made-up timer result.
import { useEffect, useState } from "react";
import type { SaplingSession } from "../connect/session";
import { readLimits, usagePollResult, type Limits, type UpdateInfo } from "./status-data";
import { componentDesktop, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus } from "../connect/desktop-component-updates";

import { isNewerBranchVersion } from "../connect/branch-version";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const RELEASE_URL = "https://api.github.com/repos/KeepOak/Branch-Agent/releases/latest";
const BRANCH_RELEASE = /^v?(\d+\.\d+\.\d+(?:-build-[a-zA-Z0-9]+)?)$/;

async function latestBranchRelease(signal: AbortSignal): Promise<string> {
  const response = await fetch(RELEASE_URL, { signal, cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`Release check failed (${response.status})`);
  const release = rec(await response.json());
  const version = BRANCH_RELEASE.exec(typeof release.tag_name === "string" ? release.tag_name : "")?.[1];
  if (!version || !Array.isArray(release.assets) || !release.assets.some((asset) =>
    typeof rec(asset).name === "string" && /^branch-release-(?:win32|darwin|linux)-(?:x64|arm64)\.json$/.test(rec(asset).name as string))) {
    throw new Error("Release manifest is unavailable");
  }
  return version;
}

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
        (r) => {
          const next = readLimits(r);
          setLimits(next);
          window.dispatchEvent(new CustomEvent("branch:usage-checked", { detail: next }));
        },
        (error: unknown) => console.warn("usage.status failed", error),
      );
    void load();
    const timer = setInterval(load, 5 * 60_000);
    const onChecked = (event: Event) => {
      const next = usagePollResult(event);
      if (next) {
        setLimits(next);
        return;
      }
      void load();
    };
    window.addEventListener("branch:usage-checked", onChecked);
    const off = session.onGatewayEvent((event, payload) => {
      if (event === "chat" && rec(payload).state === "final") void load();
    });
    return () => { clearInterval(timer); window.removeEventListener("branch:usage-checked", onChecked); off(); };
  }, [session, ready]);
  return limits;
}

/** Branch component updates come from the desktop, or the same GitHub release feed in a browser. */
export function useUpdate(session: SaplingSession, ready: boolean, version: string): UpdateInfo | null {
  const desktop = componentDesktop(session.gatewayUrl);
  const remote = !desktop;
  const native = useDesktopComponentStatus(session.gatewayUrl);
  const [release, setRelease] = useState<{ version: string | null; error: string | null }>({ version: null, error: null });
  useEffect(() => {
    if (!ready || !remote) return;
    const controller = new AbortController();
    const load = () => void latestBranchRelease(controller.signal).then(
      (latest) => setRelease({ version: latest, error: null }),
      (error: unknown) => { if (!controller.signal.aborted) setRelease({ version: null, error: error instanceof Error ? error.message : String(error) }); },
    );
    load();
    const timer = setInterval(load, 10 * 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [ready, remote]);
  if (!ready) return null;
  if (desktop) {
    const status = native.status;
    const current = status?.currentVersion ?? version;
    const newer = Boolean(current.trim()) && isNewerBranchVersion(status?.latestVersion, current);
    const available = newer && (status?.phase === "available" || status?.phase === "staged");
    return { current, latest: available ? status.latestVersion : null, notes: [],
      installing: status?.phase === "staging" || (available && status?.phase === "staged"),
      waiting: available && status?.phase === "staged" ? "Downloaded. Restart Branch when your work is ready."
        : status?.phase === "staging" ? "Downloading and checking the update." : null,
      statusMessage: !desktop.componentUpdates ? desktop.unavailableReason ?? MANUAL_UPDATE_UNSUPPORTED : native.error ??
        (status?.phase === "current" ? undefined : "Check for updates in Updates & about.") };
  }
  return { current: version, latest: version.trim() && isNewerBranchVersion(release.version, version) ? release.version : null,
    notes: [], installing: false, waiting: null,
    statusMessage: release.error ?? (release.version ? undefined : "Checking Branch releases…") };
}
