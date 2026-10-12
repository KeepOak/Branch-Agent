import { describe, expect, it, vi } from "vitest";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginRegistry } from "../plugins/registry-types.js";
import { createPluginReloadCleanup } from "./server-plugin-reload-cleanup.js";

vi.mock("../plugins/plugin-instance-scope.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../plugins/plugin-instance-scope.js")>()),
  getPluginInstance: () => ({}),
}));

const record = (id: string) => ({ id, enabled: true, status: "loaded", format: "module" });
const registry = (id: string, hasComputerProvider: boolean) =>
  ({
    plugins: [record(id)],
    nodeHostCommands: hasComputerProvider
      ? [{ pluginId: id, command: { command: "computer.act" } }]
      : [],
  }) as unknown as PluginRegistry;

function handoff(previous: PluginRegistry, next: PluginRegistry, id: string) {
  const cleanup = createPluginReloadCleanup({
    previousRegistry: previous,
    changedPluginIds: new Set<string>(),
    port: 0,
    pluginWorkspaceDir: undefined,
    getCron: vi.fn() as never,
    abortSignal: new AbortController().signal,
    log: createSubsystemLogger("gateway/test"),
    recordCleanup: vi.fn(),
    recordWarning: vi.fn(),
    retainRetirement: vi.fn(),
  });
  return cleanup.selectResourceHandoff(next, new Set([id]));
}

describe("Gateway computer provider reload", () => {
  it("activates the first CUA provider without waiting for old node-policy work", () => {
    expect(handoff(registry("cua-computer", false), registry("cua-computer", true), "cua-computer"))
      .toEqual(new Set());
  });

  it("still drains a CUA provider replacement and unrelated plugin replacements", () => {
    expect(handoff(registry("cua-computer", true), registry("cua-computer", true), "cua-computer"))
      .toEqual(new Set(["cua-computer"]));
    expect(handoff(registry("cua-computer", false), registry("cua-computer", false), "cua-computer"))
      .toEqual(new Set(["cua-computer"]));
    expect(handoff(registry("other", false), registry("other", false), "other"))
      .toEqual(new Set(["other"]));
  });
});
