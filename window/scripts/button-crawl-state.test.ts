import { describe, expect, it } from "vitest";
import { applyApprovalsSet, applyConfigPatch, applyOutsideSet, applyPrefsSet, applyVoiceToggle, freshApprovals, freshConfig, freshOutside, freshPrefs, freshVoice, mergeConfig, voiceProviders, voiceStatus } from "./button-crawl-state";

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

describe("button crawl connected agents", () => {
  it("the master switch stays off after contacts.outside.set, and a fresh list starts on", () => {
    expect(freshOutside()).toEqual({ enabled: true, agents: [] });
    const off = applyOutsideSet(freshOutside(), { enabled: false });
    expect(off).toEqual({ enabled: false, agents: [] });
    expect(freshOutside().enabled).toBe(true);
    const row = { id: "codex", name: "Codex", revoked: false, mayDriveWindow: false };
    const next = applyOutsideSet({ enabled: true, agents: [row] }, { id: "codex", revoked: true });
    expect(next.agents).toEqual([{ ...row, revoked: true }]);
    expect(row.revoked).toBe(false);
  });
});

describe("button crawl exec approvals state", () => {
  it("a saved Ask choice is read back, and a write with a stale base hash is refused", () => {
    const start = freshApprovals();
    const file = { ...(start.file as object), defaults: { ...(start.file.defaults as object), ask: "always" } };
    const saved = applyApprovalsSet(start, { file, baseHash: start.hash });
    expect(saved.resolvedDefaults.ask).toBe("always");
    expect(saved.hash).not.toBe(start.hash);
    expect(() => applyApprovalsSet(saved, { file, baseHash: start.hash })).toThrow(/changed since last load/);
    expect(freshApprovals().resolvedDefaults.ask).toBe("off");
  });
});

describe("button crawl voice state", () => {
  it("turning reading aloud on is read back as always, and off is read back as off", () => {
    const on = applyVoiceToggle(freshVoice(), true);
    expect(on.auto).toBe("always");
    expect(voiceStatus(on).enabled).toBe(true);
    expect(voiceStatus(applyVoiceToggle(on, false))).toMatchObject({ enabled: false, auto: "off" });
    expect(freshVoice().auto).toBe("off");
  });

  // The mock must answer with the engine's field names (gateway/server-methods/tts.ts). A missing or renamed field
  // would make a control look dead for the wrong reason.
  it("tts.status has the engine's fields (tts.ts:67-105: enabled, auto, provider, persona, personas, fallback, prefsPath, providerStates)", () => {
    expect(Object.keys(voiceStatus(freshVoice())).sort()).toEqual(
      ["auto", "enabled", "fallbackProvider", "fallbackProviders", "persona", "personas", "prefsPath", "provider", "providerStates"],
    );
  });

  it("tts.providers has the engine's fields (tts.ts:287-300: providers with id, name, configured, models, voices; and active)", () => {
    const payload = voiceProviders(freshVoice());
    expect(Object.keys(payload).sort()).toEqual(["active", "providers"]);
    expect(Object.keys(payload.providers[0]).sort()).toEqual(["configured", "id", "models", "name", "voices"]);
  });
});

describe("button crawl exec approvals shape", () => {
  // exec.approvals.get answers with the snapshot (gateway/server-methods/exec-approvals.ts:202-218, toExecApprovalsPayload
  // at :81). Its schema is packages/gateway-protocol/src/schema/exec-approvals.ts:86-92.
  it("the snapshot has the engine's fields: path, exists, hash, file and resolvedDefaults", () => {
    expect(Object.keys(freshApprovals()).sort()).toEqual(["exists", "file", "hash", "path", "resolvedDefaults"]);
  });
});
