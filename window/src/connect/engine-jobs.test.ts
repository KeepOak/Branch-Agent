import { expect, it } from "vitest";
import { isEngineJob } from "./engine-jobs";

it("marks the engine's heartbeat monitor as an engine job", () => {
  expect(isEngineJob({ name: "Heartbeat (main)", payload: { kind: "heartbeat" } })).toBe(true);
});

it("marks the overnight memory cleanup and the skill collection review as engine jobs", () => {
  expect(isEngineJob({ name: "Memory Rings Promotion", description: "" })).toBe(true);
  expect(isEngineJob({ name: "Nightly", description: "[managed-by=memory-core.short-term-promotion] rings" })).toBe(true);
  expect(isEngineJob({ name: "skill-collection-review-main", payload: { kind: "agentTurn" } })).toBe(true);
});

it("leaves the person's own automations alone", () => {
  expect(isEngineJob({ name: "Morning brief", payload: { kind: "agentTurn", message: "Summarise my inbox" } })).toBe(false);
  expect(isEngineJob({ name: "Backup", tags: "backups" })).toBe(false);
});
