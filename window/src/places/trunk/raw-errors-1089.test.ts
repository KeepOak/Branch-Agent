// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): a Trunk's profile listed "Automations: <raw engine error>", and Customize's
// tool lines and the setup steps showed the engine's raw words. They now read plain at Regular.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadProfile } from "./profile-data";

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "unknown method: cron.list",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
// The roster and config answer, so the profile loads; every other read fails with the engine's raw words.
const failing = (message: string) => ({ sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], onEvent: () => () => {}, request: vi.fn(async (method: string) => {
  if (method === "agents.list") return { defaultId: "main", mainKey: "main", agents: [{ id: "main", identity: { name: "Scout" } }] };
  if (method === "config.get") return { config: {}, hash: "h" };
  throw new Error(message);
}) }) as unknown as WindowEngine;
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("a Trunk's profile notes never carry a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("%j", async (raw) => {
    const profile = await loadProfile(failing(raw), "main");
    expect(profile.notes.length).toBeGreaterThan(0);
    for (const note of profile.notes) expect(note).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    const profile = await loadProfile(failing(FAILURES[1]), "main");
    expect(profile.notes.join(" ")).toContain("ECONNREFUSED");
  });
});
