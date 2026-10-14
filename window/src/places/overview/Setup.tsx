// Overview › Finish setting up (preview.html SETUP_R618 and the Overview card: "Finish setting up", "N of 9 done", nine
// steps with a tick when done). Each step's state is read from the engine: a model account (models.list), how much it
// may do (config tools.exec.mode), your first Trunk (agents.list), your phone (device.pair.list), tools (config
// mcp.servers), add someone (users.list), and a routine of your own (cron.list). "Keep it running" and "Bring in your
// history" have no engine read yet, so they say Coming. Hide turns the General row off ("checklist": false).
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { notify } from "../../shell/notify";
import { lookStore } from "../settings/set1/appearance-store";
import { useResource } from "../library/data";
import { PairDialog } from "../customize/pairing";
import { errorText } from "../settings/adapter";
import { isEngineJob } from "../../connect/engine-jobs";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

/** The nine steps, in the preview's order and words. */
export const SETUP_STEPS = ["Your models", "How much it may do", "Your first Trunk", "Reach it anywhere", "Tools", "Keep it running", "Add someone", "Bring in your history", "Make it a routine"] as const;
export type SetupKey = "models" | "howMuch" | "firstTrunk" | "reach" | "tools" | "keep" | "people" | "history" | "routine";
const KEYS: SetupKey[] = ["models", "howMuch", "firstTrunk", "reach", "tools", "keep", "people", "history", "routine"];

export type SetupInput = { models: unknown; devices: unknown; agents: unknown; config: unknown; users: unknown; jobs: unknown };
export type SetupFacts = Record<SetupKey, boolean>;

/** Which steps are done, from the engine's answers. */
export function setupFacts(input: SetupInput): SetupFacts {
  const phone = arr(rec(input.devices).paired).some((d) => /ios|iphone|ipad|android/i.test(`${String(d.platform ?? "")} ${String(d.deviceFamily ?? "")}`));
  // config.get answers with the snapshot: { hash, valid, config }.
  const config = rec(rec(input.config).config);
  const tools = rec(config.tools);
  return {
    models: arr(rec(input.models).models).some((m) => m.available !== false),
    howMuch: typeof rec(tools.exec).mode === "string" && rec(tools.exec).mode !== "",
    firstTrunk: arr(rec(input.agents).agents).filter((a) => a.kind !== "system" && typeof a.id === "string" && a.id !== "").length >= 2,
    reach: phone,
    tools: Object.keys(rec(rec(config.mcp).servers)).length > 0,
    keep: false,
    people: arr(rec(input.users).profiles).length >= 2,
    history: false,
    routine: arr(rec(input.jobs).jobs).some((j) => !isEngineJob(j)),
  };
}

/** Where a step's "Do it" goes, for the steps the window can open. */
const GO: Partial<Record<SetupKey, { page?: string; place?: string; tab?: string }>> = {
  models: { page: "models" },
  howMuch: { page: "permissions" },
  reach: {},
  tools: { place: "customize", tab: "Connectors" },
  people: { place: "people" },
  routine: { place: "automations" },
};

export function FinishSetup({ engine, openSettings }: { engine: WindowEngine; openSettings?: (page: string) => void }) {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  const models = useResource<unknown>(engine, "models.list");
  const devices = useResource<unknown>(engine, "device.pair.list");
  const agents = useResource<unknown>(engine, "agents.list");
  const config = useResource<unknown>(engine, "config.get");
  const users = useResource<unknown>(engine, "users.list");
  const jobs = useResource<unknown>(engine, "cron.list", { includeDisabled: true });
  const [pairing, setPairing] = useState(false);
  useEffect(() => { if (store.snap.where === "loading") void store.load(); }, [store]);
  const loading = [models, devices, agents, config, users, jobs].some((r) => r.loading);
  if (look.checklist === false || loading) return null;
  const facts = setupFacts({ models: models.data, devices: devices.data, agents: agents.data, config: config.data, users: users.data, jobs: jobs.data });
  const done = KEYS.filter((k) => facts[k]).length;
  if (done === KEYS.length) return null;
  const save = (key: string, value: unknown, notice?: string) => store.set(key, value).then(() => { if (notice) notify(notice); }, (e: unknown) => notify(`Couldn’t save that: ${errorText(e)}`, { tone: "bad" }));
  const act = (key: SetupKey) => {
    if (key === "reach") { setPairing(true); return; }
    const go = GO[key];
    if (!go) return;
    if (go.page) { openSettings?.(go.page); return; }
    window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: go.place, tab: go.tab } }));
  };
  return (
    <section className="ov-setup" aria-label="Finish setting up" data-testid="finish-setup">
      <div className="ov-setup-h">
        <b>Finish setting up</b>
        <small>{done} of {KEYS.length} done</small>
        <button type="button" className="btn ghost sm" onClick={() => void save("checklist", false, "Hidden. Settings › General brings it back.")}>Hide</button>
      </div>
      <div className="ov-setup-l">
        {KEYS.map((key, i) => {
          const ok = facts[key];
          const reachable = ok || key === "reach" || Boolean(GO[key]);
          return (
            <button key={key} type="button" className="ov-step" aria-pressed={ok} disabled={!reachable} onClick={() => act(key)}>
              <span aria-hidden="true">{ok ? "✓" : "○"}</span>{SETUP_STEPS[i]}
              {!ok && !reachable ? <span className="pill idle">Coming</span> : null}
            </button>
          );
        })}
      </div>
      {pairing ? <PairDialog engine={engine} close={() => { setPairing(false); devices.reload(); }} /> : null}
    </section>
  );
}
