import { stripVTControlCharacters } from "node:util";
import { spyRuntimeErrors, spyRuntimeLogs } from "branch/plugin-sdk/test-fixtures";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getMemorySearchManager = vi.hoisted(() => vi.fn());
const scanMemoryManagerSources = vi.hoisted(() => vi.fn());
const getRuntimeConfig = vi.hoisted(() => vi.fn(() => ({})));
const resolveCommandSecretRefsViaGateway = vi.hoisted(() =>
  vi.fn(async ({ config }: { config: unknown }) => ({ resolvedConfig: config, diagnostics: [] })),
);

vi.mock("./memory/index.js", () => ({ getMemorySearchManager }));
vi.mock("./cli-runtime-common.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cli-runtime-common.js")>()),
  scanMemoryManagerSources,
}));
vi.mock("branch/plugin-sdk/memory-core-host-runtime-cli", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/memory-core-host-runtime-cli")>()),
  resolveCommandSecretRefsViaGateway,
}));
vi.mock("branch/plugin-sdk/memory-core-host-runtime-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/memory-core-host-runtime-core")>()),
  getRuntimeConfig,
}));

let runMemoryStatus: typeof import("./cli-status.runtime.js").runMemoryStatus;
let defaultRuntime: typeof import("branch/plugin-sdk/memory-core-host-runtime-cli").defaultRuntime;

beforeAll(async () => {
  ({ runMemoryStatus } = await import("./cli-status.runtime.js"));
  ({ defaultRuntime } = await import("branch/plugin-sdk/memory-core-host-runtime-cli"));
});

beforeEach(() => {
  process.exitCode = 0;
  getMemorySearchManager.mockReset();
  scanMemoryManagerSources.mockReset().mockResolvedValue(undefined);
  getRuntimeConfig.mockReset().mockReturnValue({
    agents: { list: [{ id: "slow" }, { id: "fast" }] },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

function statusFor(agentId: string) {
  return {
    backend: "builtin" as const,
    files: 0,
    chunks: 0,
    dirty: false,
    dbPath: `/tmp/${agentId}.sqlite`,
    provider: "none",
    requestedProvider: "none",
  };
}

const flat = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => stripVTControlCharacters(String(call[0]))).join("\n");

describe("memory status per-agent bound (#1974)", () => {
  it("reports a stuck agent with a clear error and still prints the others", async () => {
    const close = vi.fn(async () => {});
    // A stalled store read: this agent's status work never settles.
    scanMemoryManagerSources.mockImplementation(async (status: { dbPath?: string }) =>
      status.dbPath?.includes("slow") ? new Promise(() => {}) : undefined,
    );
    getMemorySearchManager.mockImplementation(async ({ agentId }: { agentId: string }) => ({
      manager: { status: () => statusFor(agentId), close },
    }));

    const log = spyRuntimeLogs(defaultRuntime);
    const error = spyRuntimeErrors(defaultRuntime);
    await runMemoryStatus({}, undefined, { agentTimeoutMs: 20 });

    expect(flat(error)).toContain('memory status timed out for agent "slow" after 0.02 seconds');
    expect(flat(error)).toContain("--agent slow");
    expect(flat(log)).toContain("Memory Search (fast)");
    expect(flat(log)).not.toContain("Memory Search (slow)");
    expect(process.exitCode).toBe(1);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("prints each agent as soon as it finishes instead of after all agents", async () => {
    const log = spyRuntimeLogs(defaultRuntime);
    let printedBeforeSecondOpened = false;
    getMemorySearchManager.mockImplementation(async ({ agentId }: { agentId: string }) => {
      if (agentId === "fast") {
        printedBeforeSecondOpened = flat(log).includes("Memory Search (slow)");
      }
      return { manager: { status: () => statusFor(agentId), close: vi.fn(async () => {}) } };
    });

    await runMemoryStatus({});

    expect(printedBeforeSecondOpened).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});
