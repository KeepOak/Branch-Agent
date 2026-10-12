import { beforeEach, expect, it, vi } from "vitest";
import { runDailyModelUpgradeProbe } from "./model-upgrade-probe.js";

const { probe, writeState, mutate, cfg } = vi.hoisted(() => {
  const cfg = { agents: { defaults: { model: "openai/gpt-6-sol" }, entries: {
    ash: { model: "openai/gpt-6-sol" }, elm: { model: "openai/gpt-6-sol" },
  } } };
  return { cfg, probe: vi.fn(), writeState: vi.fn(), mutate: vi.fn() };
});

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: () => ({ profiles: {
    "openai:a": { type: "oauth" }, "openai:b": { type: "oauth" },
  } }),
  resolveAuthProfileOrder: () => ["openai:a", "openai:b"],
}));
vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: () => ["ash", "elm"],
  resolveAgentDir: () => "fixture-agent-dir",
  resolveAgentExplicitModelPrimary: (value: typeof cfg, id: "ash" | "elm") => value.agents.entries[id].model,
  setAgentEffectiveModelPrimary: (value: typeof cfg, id: "ash" | "elm", model: string, options: { target: string }) => {
    if (options.target === "defaults") value.agents.defaults.model = model;
    else value.agents.entries[id].model = model;
  },
}));
vi.mock("../commands/models/list.probe.js", () => ({ runAuthProbes: probe }));
vi.mock("../config/config.js", () => ({
  getRuntimeConfig: () => cfg,
  mutateConfigFileWithRetry: mutate,
}));
vi.mock("../config/paths.js", () => ({ resolveIsConfigReadOnly: () => false }));
vi.mock("./model-upgrade-state.js", () => ({
  readModelUpgradeState: async () => ({}), writeModelUpgradeState: writeState,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockImplementation(async ({ mutate: apply }: { mutate: (draft: typeof cfg) => number }) => ({ result: apply(structuredClone(cfg)) }));
});

it("only auto-switches after every ChatGPT profile accepts the Codex-harness probe", async () => {
  probe.mockResolvedValueOnce({ results: [
    { profileId: "openai:a", model: "openai/gpt-6.1-sol", status: "ok" },
    { profileId: "openai:b", model: "openai/gpt-6.1-sol", status: "format" },
  ] });
  await runDailyModelUpgradeProbe(1_800_000_000_000);
  expect(mutate).not.toHaveBeenCalled();
  expect(writeState).toHaveBeenCalledWith({ checkedAt: 1_800_000_000_000 });

  probe.mockResolvedValueOnce({ results: [
    { profileId: "openai:a", model: "openai/gpt-6.1-sol", status: "ok" },
    { profileId: "openai:b", model: "openai/gpt-6.1-sol", status: "ok" },
  ] });
  await runDailyModelUpgradeProbe(1_800_000_000_001);
  expect(probe).toHaveBeenLastCalledWith(expect.objectContaining({
    options: expect.objectContaining({ profileIds: ["openai:a", "openai:b"], agentHarnessRuntimeOverride: "codex", maxTokens: 8 }),
  }));
  expect(mutate).toHaveBeenCalledOnce();
  expect(writeState).toHaveBeenCalledWith(expect.objectContaining({ notice: expect.stringContaining("GPT-6.1 Sol is now available") }));
});
