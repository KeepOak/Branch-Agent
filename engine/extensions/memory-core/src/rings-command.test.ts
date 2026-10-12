// Memory Core tests cover rings command plugin behavior.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { PluginCommandContext } from "branch/plugin-sdk/core";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { asNullableRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { describe, expect, it, vi } from "vitest";
import { handleRingsCommand } from "./rings-command.js";

function resolveStoredRings(config: BranchConfig): Record<string, unknown> {
  const entry = asNullableRecord(config.plugins?.entries?.["memory-core"]);
  const pluginConfig = asNullableRecord(entry?.config);
  return asNullableRecord(pluginConfig?.rings) ?? {};
}

function createHarness(initialConfig: BranchConfig = {}) {
  let runtimeConfig: BranchConfig = initialConfig;

  const runtime = {
    config: {
      current: vi.fn(() => runtimeConfig),
      loadConfig: vi.fn(() => runtimeConfig),
      mutateConfigFile: vi.fn(async ({ mutate }: { mutate: (draft: BranchConfig) => void }) => {
        const draft = structuredClone(runtimeConfig);
        mutate(draft);
        runtimeConfig = draft;
        return {
          path: "/tmp/branch.json",
          previousHash: null,
          persistedHash: null,
          snapshot: {},
          nextConfig: runtimeConfig,
          afterWrite: { mode: "auto" },
          followUp: { mode: "auto", requiresRestart: false },
          result: undefined,
        };
      }),
      replaceConfigFile: vi.fn(async ({ nextConfig }: { nextConfig: BranchConfig }) => {
        runtimeConfig = nextConfig;
      }),
      writeConfigFile: vi.fn(async (nextConfig: BranchConfig) => {
        runtimeConfig = nextConfig;
      }),
    },
  } as unknown as BranchPluginApi["runtime"];

  const api = {
    runtime,
  } as unknown as BranchPluginApi;

  return {
    api,
    runtime,
    getRuntimeConfig: () => runtimeConfig,
  };
}

function createCommandContext(
  args?: string,
  config: BranchConfig = {},
  overrides?: Partial<Pick<PluginCommandContext, "gatewayClientScopes" | "senderIsOwner">>,
): PluginCommandContext {
  return {
    channel: "webchat",
    isAuthorizedSender: true,
    commandBody: args ? `/rings ${args}` : "/rings",
    args,
    config,
    gatewayClientScopes: overrides?.gatewayClientScopes,
    senderIsOwner: overrides?.senderIsOwner,
    requestConversationBinding: async () => ({ status: "error", message: "unsupported" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  };
}

async function runRingsCommand(
  harness: ReturnType<typeof createHarness>,
  args?: string,
  overrides?: Partial<Pick<PluginCommandContext, "gatewayClientScopes" | "senderIsOwner">>,
) {
  return await handleRingsCommand(
    harness.api,
    createCommandContext(args, harness.getRuntimeConfig(), overrides),
  );
}

describe("memory-core /rings command", () => {
  it("shows phase explanations when invoked without args", async () => {
    const harness = createHarness();
    const result = await runRingsCommand(harness);

    expect(result.text).toContain("Usage: /rings status");
    expect(result.text).toContain("Rings status:");
    expect(result.text).toContain("- implementation detail: each sweep runs light -> REM -> deep.");
    expect(result.text).toContain(
      "- deep is the only stage that writes durable entries to MEMORY.md.",
    );
  });

  it("blocks non-owner external channel callers from persisting rings config", async () => {
    const harness = createHarness();

    const result = await runRingsCommand(harness, "off");

    expect(result.text).toContain(
      "requires owner status for channel callers or operator.admin for gateway clients",
    );
    expect(harness.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("allows owner external channel callers to persist global enablement", async () => {
    const harness = createHarness({
      plugins: {
        entries: {
          "memory-core": {
            config: {
              rings: {
                phases: {
                  deep: {
                    minScore: 0.9,
                  },
                },
                frequency: "0 */6 * * *",
              },
            },
          },
        },
      },
    });

    const result = await runRingsCommand(harness, "off", {
      senderIsOwner: true,
    });

    expect(harness.runtime.config.mutateConfigFile).toHaveBeenCalledTimes(1);
    const storedRings = resolveStoredRings(harness.getRuntimeConfig());
    expect(storedRings.enabled).toBe(false);
    expect(storedRings.frequency).toBe("0 */6 * * *");
    expect(result.text).toContain("Rings disabled.");
  });

  it("blocks unscoped gateway callers from persisting rings config", async () => {
    const harness = createHarness();

    const result = await runRingsCommand(harness, "off", {
      gatewayClientScopes: [],
    });

    expect(result.text).toContain(
      "requires owner status for channel callers or operator.admin for gateway clients",
    );
    expect(harness.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("blocks write-scoped gateway callers from persisting rings config", async () => {
    const harness = createHarness();

    const result = await runRingsCommand(harness, "off", {
      gatewayClientScopes: ["operator.write"],
    });

    expect(result.text).toContain(
      "requires owner status for channel callers or operator.admin for gateway clients",
    );
    expect(harness.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("allows admin-scoped gateway callers to persist rings config", async () => {
    const harness = createHarness();

    const result = await runRingsCommand(harness, "on", {
      gatewayClientScopes: ["operator.admin"],
    });

    expect(harness.runtime.config.mutateConfigFile).toHaveBeenCalledTimes(1);
    expect(resolveStoredRings(harness.getRuntimeConfig()).enabled).toBe(true);
    expect(result.text).toContain("Rings enabled.");
  });

  it("returns status without mutating config", async () => {
    const harness = createHarness({
      plugins: {
        entries: {
          "memory-core": {
            config: {
              rings: {
                frequency: "15 */8 * * *",
              },
            },
          },
        },
      },
      agents: {
        defaults: {
          userTimezone: "America/Los_Angeles",
        },
      },
    });

    const result = await runRingsCommand(harness, "status");

    expect(result.text).toContain("Rings status:");
    // Rings is enabled by default; the fixture sets no explicit enabled flag.
    expect(result.text).toContain("- enabled: on (America/Los_Angeles)");
    expect(result.text).toContain("- sweep cadence: 15 */8 * * *");
    expect(result.text).toContain("- promotion policy: score>=0.75, recalls>=3, uniqueQueries>=3");
    expect(harness.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("shows usage for invalid args and does not mutate config", async () => {
    const harness = createHarness();
    const result = await runRingsCommand(harness, "unknown-mode");

    expect(result.text).toContain("Usage: /rings status");
    expect(harness.runtime.config.mutateConfigFile).not.toHaveBeenCalled();
  });
});
