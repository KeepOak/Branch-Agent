import { describe, expect, it } from "vitest";
import { applyConfigPatch, applyPrefsSet, freshConfig, freshPrefs, mergeConfig } from "./button-crawl-state";

describe("button crawl mock engine state", () => {
  it("a config.patch from one click does not reach the next click's fresh config", () => {
    const first = freshConfig();
    const patched = applyConfigPatch(first, JSON.stringify({ agents: { defaults: { model: { primary: null } } } }));
    expect(patched.config).toEqual({ wizard: { lastRunAt: "2026-10-01T00:00:00Z" }, agents: { defaults: { model: {} } } });
    expect(patched.hash).toBe("fixturex");
    expect(freshConfig()).toEqual({
      hash: "fixture",
      config: { wizard: { lastRunAt: "2026-10-01T00:00:00Z" }, agents: { defaults: { model: { primary: "local/fixture" } } } },
    });
  });

  it("a stored pref from one click is gone after the reset, and null removes a pref", () => {
    const set = applyPrefsSet(freshPrefs(), { "ui.window.look": { pet: "cat" }, "ui.other": true });
    expect(set.entries).toEqual({ "ui.window.look": { pet: "cat" }, "ui.other": true });
    expect(applyPrefsSet(set, { "ui.other": null }).entries).toEqual({ "ui.window.look": { pet: "cat" } });
    expect(freshPrefs()).toEqual({ status: "ok", entries: {} });
  });

  it("the fresh values are copies, so mutating one never changes the next reset", () => {
    const config = freshConfig();
    (config.config.agents as Record<string, unknown>).defaults = "changed";
    const prefs = freshPrefs();
    prefs.entries.leaked = true;
    expect(freshConfig().config.agents).toEqual({ defaults: { model: { primary: "local/fixture" } } });
    expect(freshPrefs().entries).toEqual({});
  });

  it("mergeConfig deletes on null, merges objects, replaces arrays and scalars, and does not mutate its input", () => {
    const base = { a: { b: 1, c: [1, 2] }, d: "x" };
    const merged = mergeConfig(base, { a: { b: null, c: [3] }, d: 2 }) as Record<string, unknown>;
    expect(merged).toEqual({ a: { c: [3] }, d: 2 });
    expect(base).toEqual({ a: { b: 1, c: [1, 2] }, d: "x" });
  });
});
