// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadProfile } from "./profile-data";

it("a Trunk's profile lists its own automations, and never the engine's check-in, cleanup or review", async () => {
  const jobs = [
    { id: "hb", name: "Heartbeat (main)", agentId: "main", payload: { kind: "heartbeat" }, enabled: true },
    { id: "rings", name: "Memory Rings Promotion", agentId: "main", enabled: true },
    { id: "rev", name: "skill-collection-review-main", agentId: "main", enabled: true },
    { id: "mine", name: "Morning brief", agentId: "main", payload: { kind: "agentTurn" }, enabled: true },
  ];
  const engine = {
    request: vi.fn(async (method: string) => {
      if (method === "cron.list") return { jobs };
      if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] };
      return {};
    }),
  } as unknown as WindowEngine;
  const profile = await loadProfile(engine, "main");
  expect(profile.automations?.map((a) => a.id)).toEqual(["mine"]);
});
