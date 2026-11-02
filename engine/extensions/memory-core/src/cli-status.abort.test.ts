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

const statusFor = (agentId: string) => ({
  backend: "builtin" as const,
  files: 0,
  chunks: 0,
  dirty: false,
  dbPath: `/tmp/${agentId}.sqlite`,
  provider: "none",
  requestedProvider: "none",
});

const flat = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => stripVTControlCharacters(String(call[0]))).join("\n");

describe("memory status timeout releases the command (#1974)", () => {
  it("returns soon after the cap even when the agent's work and its close never settle", async () => {
    // Real managers wait for in-flight work on close, so a stalled agent also stalls close.
    const never = () => new Promise<never>(() => {});
    scanMemoryManagerSources.mockImplementation(async (status: { dbPath?: string }) =>
      status.dbPath?.includes("slow") ? never() : undefined,
    );
    const fastClose = vi.fn(async () => {});
    getMemorySearchManager.mockImplementation(async ({ agentId }: { agentId: string }) => ({
      manager: {
        status: () => statusFor(agentId),
        close: agentId === "slow" ? never : fastClose,
      },
    }));

    const log = spyRuntimeLogs(defaultRuntime);
    const error = spyRuntimeErrors(defaultRuntime);
    const started = Date.now();
    await runMemoryStatus({}, undefined, { agentTimeoutMs: 20, closeGraceMs: 20 });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(flat(error)).toContain('memory status timed out for agent "slow"');
    expect(flat(error)).toContain('agent "slow" is still busy after its timeout');
    expect(flat(log)).toContain("Memory Search (fast)");
    expect(fastClose).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  it("still waits for close normally when an agent did not time out", async () => {
    let closed = false;
    getMemorySearchManager.mockImplementation(async ({ agentId }: { agentId: string }) => ({
      manager: {
        status: () => statusFor(agentId),
        close: async () => {
          await new Promise((resolve) => {
            setTimeout(resolve, 50);
          });
          closed = true;
        },
      },
    }));
    await runMemoryStatus({}, undefined, { agentTimeoutMs: 1_000, closeGraceMs: 1 });
    expect(closed).toBe(true);
    expect(process.exitCode).toBe(0);
  });
});
