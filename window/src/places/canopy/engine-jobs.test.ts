// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadCanopy } from "./data";

it("Canopy leaves out the engine's own jobs and their runs, and keeps the person's", async () => {
  const jobs = [
    { id: "hb", name: "Heartbeat (main)", payload: { kind: "heartbeat" }, enabled: true },
    { id: "rings", name: "Memory Rings Promotion", enabled: true },
    { id: "rev", name: "skill-collection-review-main", enabled: true },
    { id: "mine", name: "Morning brief", payload: { kind: "agentTurn" }, enabled: true },
  ];
  const now = Date.now();
  const runs = [{ jobId: "hb", ts: now }, { jobId: "rings", ts: now }, { jobId: "mine", ts: now }];
  const engine = {
    request: vi.fn(async (method: string) => {
      if (method === "cron.list") return { jobs };
      if (method === "cron.runs") return { entries: runs };
      return {};
    }),
  } as unknown as WindowEngine;
  const data = await loadCanopy(engine);
  expect(data.jobs.map((j) => j.id)).toEqual(["mine"]);
  expect(data.runs.map((r) => r.jobId)).toEqual(["mine"]);
});
