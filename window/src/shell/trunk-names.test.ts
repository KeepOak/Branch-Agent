// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { readTrunks } from "./engine-data";
import { comingUp } from "./status-data";
import { loadScheduled } from "../places/automations/data";
import { placeTitle } from "../screens/frame/R1Window";

it("the Trunk list shows the default Trunk as Sapling, not its id, when the engine has no name for it", () => {
  const trunks = readTrunks({ defaultId: "main", agents: [{ id: "main" }, { id: "scout", identity: { name: "Scout" } }] });
  expect(trunks.list.map((t) => t.name)).toEqual(["Sapling", "Scout"]);
});

it("the places with no sidebar row read as their names, not their route ids", () => {
  expect(placeTitle("office")).toBe("Grove");
  expect(placeTitle("seedbank")).toBe("Seedbank");
});

it("Coming up leaves out the engine's own check-in, cleanup and review jobs", () => {
  const soon = { state: { nextRunAtMs: Date.now() + 60_000 }, enabled: true };
  const jobs = [
    { name: "Heartbeat (main)", payload: { kind: "heartbeat" }, ...soon },
    { name: "Memory Rings Promotion", description: "", ...soon },
    { name: "skill-collection-review-main", payload: { kind: "agentTurn" }, ...soon },
    { name: "Morning brief", payload: { kind: "agentTurn", message: "Summarise" }, ...soon },
  ];
  expect(comingUp(jobs).map((j) => j.name)).toEqual(["Morning brief"]);
});

it("Automations lists only the person's jobs, and still reads every job from the engine", async () => {
  const jobs = [
    { id: "hb", name: "Heartbeat (main)", payload: { kind: "heartbeat" }, enabled: true },
    { id: "mem", name: "Memory Rings Promotion", enabled: true },
    { id: "rev", name: "skill-collection-review-main", enabled: true },
    { id: "mine", name: "Morning brief", payload: { kind: "agentTurn" }, enabled: true },
  ];
  const engine = {
    request: vi.fn(async (method: string) => {
      if (method === "cron.list") return { jobs };
      if (method === "cron.status") return {};
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main" }] };
      if (method === "cron.runs") return { entries: [], total: 0 };
      return {};
    }),
  } as unknown as WindowEngine;
  const scheduled = await loadScheduled(engine);
  expect(scheduled.jobs.map((j) => j.id)).toEqual(["mine"]);
  expect(scheduled.trunks).toEqual([{ id: "main", name: "Sapling" }]);
  expect([...scheduled.runs.keys()]).toEqual(["mine"]);
});
