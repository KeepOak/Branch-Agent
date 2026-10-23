// @vitest-environment node
// Private #1089: Settings funnel every engine failure through errorText → plainError, so Regular never shows a raw dump.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { errorText } from "./adapter";

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|TypeError|:\d+:\d+|logbook\.status/;
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, String(value)); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => { memory.clear(); },
  get length() { return memory.size; },
  key: (i: number) => [...memory.keys()][i] ?? null,
};

describe("settings errorText is plain at Regular (Private #1089)", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    memory.clear();
  });
  afterEach(() => { memory.clear(); });

  it("turns a thrown engine Error into one plain sentence with a next step", () => {
    expect(errorText(new Error("connect ECONNREFUSED 127.0.0.1:18789"))).toBe(REACH);
    expect(errorText("TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)")).not.toMatch(RAW);
  });

  it("keeps conflict, disconnected, stale-config and unknown-method wording so callers can detect them", () => {
    expect(errorText(new Error("conflict"))).toBe("conflict");
    expect(errorText(new Error("disconnected"))).toBe("disconnected");
    expect(errorText("disconnected")).toBe("disconnected");
    expect(errorText(new Error("config changed since last load; re-run config.get and retry"))).toBe(
      "config changed since last load; re-run config.get and retry",
    );
    expect(errorText(new Error("unknown method: visitor.policy"))).toBe("unknown method: visitor.policy");
  });

  it("Advanced keeps the exact words", () => {
    localStorage.setItem("branch.level", "advanced");
    expect(errorText(new Error("connect ECONNREFUSED 127.0.0.1:18789"))).toBe("connect ECONNREFUSED 127.0.0.1:18789");
  });
});