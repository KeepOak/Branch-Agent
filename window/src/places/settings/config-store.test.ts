import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ConfigStore, modelSafePatch, patchFor } from "./config-store";

function engineWith(handler: (method: string, params: Record<string, unknown>) => unknown): { engine: WindowEngine; calls: [string, Record<string, unknown>][] } {
  const calls: [string, Record<string, unknown>][] = [];
  const engine = {
    sessionKey: null, scopes: [], onEvent: () => () => undefined,
    request: async (method: string, params?: unknown) => { const p = (params ?? {}) as Record<string, unknown>; calls.push([method, p]); return handler(method, p); },
  } as unknown as WindowEngine;
  return { engine, calls };
}

describe("ConfigStore", () => {
  it("builds a merge patch for one dotted path", () => {
    expect(patchFor("a.b.c", 1)).toEqual({ a: { b: { c: 1 } } });
    expect(patchFor("x", null)).toEqual({ x: null });
  });

  it("queues two quick saves; the second uses the hash the first returned", async () => {
    let n = 0;
    const { engine, calls } = engineWith((method) => method === "config.get" ? { hash: "h0", config: { n: 0 }, valid: true } : { ok: true, hash: `h${++n}`, config: { n } });
    const store = new ConfigStore(engine);
    await Promise.all([store.set("a.one", true), store.set("a.two", false)]);
    const patches = calls.filter(([m]) => m === "config.patch").map(([, p]) => p);
    expect(patches.map((p) => p.baseHash)).toEqual(["h0", "h1"]);
    expect(JSON.parse(String(patches[1].raw))).toEqual({ a: { two: false } });
    expect(store.snap?.hash).toBe("h2");
  });

  it("does not let a pre-patch config read overwrite the saved revision", async () => {
    let releaseStale: ((value: unknown) => void) | undefined;
    let gets = 0;
    const { engine, calls } = engineWith((method) => {
      if (method === "config.get") {
        if (++gets === 2) return new Promise((resolve) => { releaseStale = resolve; });
        return { hash: gets === 1 ? "h0" : "h1", config: gets === 1 ? {} : { saved: true }, valid: true };
      }
      return { ok: true, hash: "h1", config: { saved: true } };
    });
    const store = new ConfigStore(engine);
    await store.load();
    const staleRead = store.load();
    const save = store.set("saved", true);
    await vi.waitFor(() => expect(calls.some(([method]) => method === "config.patch")).toBe(true));
    releaseStale?.({ hash: "h0", config: {}, valid: true });
    await Promise.all([staleRead, save]);
    expect(store.snap?.hash).toBe("h1");
    expect(store.snap?.config).toEqual({ saved: true });
  });

  it("re-reads a successful patch without a hash instead of restoring the old snapshot", async () => {
    let releaseStale: ((value: unknown) => void) | undefined;
    let gets = 0;
    const { engine, calls } = engineWith((method) => {
      if (method === "config.get") {
        if (++gets === 2) return new Promise((resolve) => { releaseStale = resolve; });
        return gets === 1
          ? { hash: "h0", config: { saved: false }, valid: true }
          : { hash: "h1", config: { saved: true }, valid: true };
      }
      return { ok: true, config: { saved: true } };
    });
    const store = new ConfigStore(engine);
    await store.load();
    const staleRead = store.load();
    const save = store.set("saved", true);
    await vi.waitFor(() => expect(calls.some(([method]) => method === "config.patch")).toBe(true));
    releaseStale?.({ hash: "h0", config: { saved: false }, valid: true });
    await Promise.all([staleRead, save]);
    expect(store.snap).toMatchObject({ hash: "h1", config: { saved: true } });
    expect(calls.filter(([method]) => method === "config.get")).toHaveLength(3);
  });

  it("reads again and retries once when the config changed elsewhere", async () => {
    let gets = 0, patches = 0;
    const { engine } = engineWith((method) => {
      if (method === "config.get") return patches === 2 ? { hash: "after", config: {}, valid: true } : { hash: `g${++gets}`, config: {}, valid: true };
      if (++patches === 1) throw new Error("config changed since last load; re-run config.get and retry");
      return { ok: true, hash: "after", config: {} };
    });
    const store = new ConfigStore(engine);
    await store.set("x", 1);
    expect(patches).toBe(2);
    expect(store.snap?.hash).toBe("after");
  });

  it("shows the committed default when the patch response still contains the old value", async () => {
    let saved = false;
    const { engine, calls } = engineWith((method) => {
      if (method === "config.get") return { hash: saved ? "h2" : "h1", valid: true, config: { agents: { defaults: { model: saved ? "openai/gpt-6.1-sol" : "llama-cpp/qwen" } } } };
      saved = true;
      return { ok: true, hash: "h2", config: { agents: { defaults: { model: "llama-cpp/qwen" } } } };
    });
    const store = new ConfigStore(engine);
    await store.set("agents.defaults.model.primary", "openai/gpt-6.1-sol");
    expect(calls.filter(([method]) => method === "config.get")).toHaveLength(2);
    expect(store.snap?.config?.agents).toEqual({ defaults: { model: "openai/gpt-6.1-sol" } });
  });

  it("refuses to save over a settings file with a problem", async () => {
    const { engine } = engineWith(() => ({ hash: "h", config: {}, valid: false }));
    await expect(new ConfigStore(engine).set("x", 1)).rejects.toThrow(/settings file has a problem/);
  });

  it("keeps a model written as a plain string when its fallbacks or primary change", () => {
    const config = { agents: { defaults: { model: "openai/gpt-5.5" } } };
    expect(modelSafePatch(config, "agents.defaults.model.fallbacks", ["ollama/qwen3:8b"])).toEqual({ agents: { defaults: { model: { primary: "openai/gpt-5.5", fallbacks: ["ollama/qwen3:8b"] } } } });
    expect(modelSafePatch(config, "agents.defaults.model.primary", "anthropic/claude")).toEqual({ agents: { defaults: { model: "anthropic/claude" } } });
    expect(modelSafePatch({ agents: { defaults: { model: { primary: "x/y" } } } }, "agents.defaults.model.fallbacks", ["a/b"])).toEqual({ agents: { defaults: { model: { fallbacks: ["a/b"] } } } });
  });
});
