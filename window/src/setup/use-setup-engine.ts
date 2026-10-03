// What setup reads from and writes to the engine (DESIGN-SPEC §4.8.1): detect, test, chat apps, the health check,
// and the setup record. Every result shown comes from one of these calls; nothing finishes on a timer.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { createJob, JOBS as JOB_FILES } from "../places/customize/jobs-data";
import { saveConfig, type ConfigSnapshot } from "../places/settings/adapter";
import { firstOn, knownSetup, readDetected, readTest, setupRecord, type Check, type Detected, type Known, type SetupChoices, type TestResult } from "./setup-model";
import type { ChatApp } from "./steps-later";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useDetected(engine: WindowEngine) {
  const [detected, setDetected] = useState<Detected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    engine.request("branch.setup.detect", engine.agentId ? { agentId: engine.agentId } : {}).then(
      (r) => setDetected(readDetected(r)),
      (e: unknown) => setError(`Couldn't look for models: ${message(e)}`),
    );
  }, [engine]);
  useEffect(load, [load]);
  return { detected, error, reload: load };
}

/** The real config (config.get), read once, as what setup already knows about this Branch. */
export function useKnown(engine: WindowEngine, detected: Detected | null, trunkNames: string[]): Known | null {
  const [config, setConfig] = useState<unknown>(null);
  useEffect(() => {
    engine.request("config.get", {}).then(setConfig, () => setConfig({}));
  }, [engine]);
  // trunkNames is a fresh array each render; its contents decide the answer.
  const names = trunkNames.join("|");
  return useMemo(() => (config === null ? null : knownSetup(config, detected, names ? names.split("|") : [])), [config, detected, names]);
}

/** "Say hello to test it". With a model already set up (and its row left on) it only verifies that model, so the
 *  default never changes behind the person's back. Otherwise it activates the first switched-on connection: the
 *  engine live-tests it and keeps it as the default only if it answers. */
export async function testModel(engine: WindowEngine, detected: Detected, off: string[], inUse: string | null): Promise<TestResult> {
  const agent = engine.agentId ? { agentId: engine.agentId } : {};
  const configured = detected.candidates.find((c) => c.kind === "existing-model");
  const keepCurrent = Boolean(inUse || configured) && !(configured && off.includes(configured.key));
  const pick = keepCurrent ? null : firstOn(detected, off);
  if (!keepCurrent && !pick) {
    return { ok: false, error: "Switch on a connection first." };
  }
  try {
    if (!pick || pick.kind === "existing-model") {
      return readTest(await engine.request("branch.setup.verify", agent));
    }
    const result = readTest(await engine.request("branch.setup.activate", { ...agent, kind: pick.kind, modelRef: pick.modelRef }));
    return result.ok ? { ...result, madeDefault: true } : result;
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/** channels.status: every chat app with whether an account of it is connected. */
export function readChatApps(result: unknown): ChatApp[] {
  const r = rec(result);
  const labels = rec(r.channelLabels);
  const accounts = rec(r.channelAccounts);
  const order = Array.isArray(r.channelOrder) ? r.channelOrder.filter((x): x is string => typeof x === "string") : [];
  return order.map((id) => ({
    id,
    label: typeof labels[id] === "string" ? (labels[id] as string) : id,
    connected: Array.isArray(accounts[id]) && (accounts[id] as unknown[]).some((a) => rec(a).connected === true || rec(a).running === true),
  }));
}

/** channels.status as setup's chat apps; `reload` reads it again after a chat app was connected. */
export function useChatApps(engine: WindowEngine): { apps: ChatApp[] | null; reload: () => void } {
  const [apps, setApps] = useState<ChatApp[] | null>(null);
  const reload = useCallback(() => {
    engine.request("channels.status", {}).then(
      (r) => setApps(readChatApps(r)),
      () => setApps([]),
    );
  }, [engine]);
  useEffect(reload, [reload]);
  return { apps, reload };
}

const gb = (bytes: number) => `${Math.round(bytes / 1024 ** 3)} GB free`;

/** The health check (§4.8.1.11): each row finishes when its own call returns. */
export function runChecks(engine: WindowEngine, apps: ChatApp[], onRow: (i: number, row: Check) => void): Check[] {
  const rows: Check[] = [
    { name: "The engine", state: "checking", line: "" },
    { name: "The model", state: "checking", line: "", fix: 2 },
    { name: "The gateway", state: "checking", line: "" },
    ...apps.filter((a) => a.connected).map((a): Check => ({ name: a.label, state: "ok", line: "connected" })),
    { name: "Disk", state: "checking", line: "" },
  ];
  const at = (name: string) => rows.findIndex((r) => r.name === name);
  const set = (name: string, row: Partial<Check>) => onRow(at(name), { ...rows[at(name)], ...row } as Check);
  const health = engine.request("health", { probe: false }).then(rec);
  health.then(
    (h) => set("The engine", { state: "ok", line: typeof h.durationMs === "number" ? `answering in ${h.durationMs} ms` : "answering" }),
    (e: unknown) => set("The engine", { state: "bad", line: message(e) }),
  );
  health.then(
    (h) => set("The gateway", h.ok === true ? { state: "ok", line: "on" } : { state: "bad", line: "not answering its health check" }),
    (e: unknown) => set("The gateway", { state: "bad", line: message(e) }),
  );
  engine.request("branch.setup.verify", engine.agentId ? { agentId: engine.agentId } : {}).then(
    (r) => {
      const t = readTest(r);
      set("The model", t.ok ? { name: t.modelRef, state: "ok", line: `answered in ${t.seconds} s` } : { state: "bad", line: t.error });
    },
    (e: unknown) => set("The model", { state: "bad", line: message(e) }),
  );
  engine.request("system.info", {}).then(
    (r) => set("Disk", typeof rec(r).diskAvailableBytes === "number" ? { state: "ok", line: gb(rec(r).diskAvailableBytes as number) } : { state: "bad", line: "this computer didn't report its disk" }),
    (e: unknown) => set("Disk", { state: "bad", line: message(e) }),
  );
  return rows;
}

/** Writes the setup record (and the update choice) so setup never opens by itself again (§4.8.1 rule 2). */
export async function recordSetup(engine: WindowEngine, choices: SetupChoices, version: string, autoUpdate: boolean | null): Promise<void> {
  const snapshot = await engine.request<ConfigSnapshot>("config.get", {});
  await saveConfig(engine, snapshot, { ...setupRecord(choices, version), ...(autoUpdate === null ? {} : { "update.auto.enabled": autoUpdate }) });
}

/** Makes the Trunks picked on step 5, the same way Customize's "Use this job" does. Returns the ones that failed. */
export async function makeTrunks(engine: WindowEngine, picked: number[], existing: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const i of picked) {
    const job = JOB_FILES[i];
    if (!job || existing.includes(job.name)) {
      continue;
    }
    try {
      await createJob(engine, job);
    } catch (e) {
      failed.push(`${job.name}: ${message(e)}`);
    }
  }
  return failed;
}
