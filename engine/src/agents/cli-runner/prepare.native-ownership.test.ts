import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { SessionManager } from "../sessions/session-manager.js";
const { resolveBackend } = vi.hoisted(() => ({
  resolveBackend: vi.fn(() => ({ id: "claude-cli", config: { command: "fixture-claude" } })),
}));
vi.mock("../cli-backends.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cli-backends.js")>()),
  resolveCliBackendConfig: resolveBackend,
}));
import { prepareCliRunContext } from "./prepare.js";
import type { RunCliAgentParams } from "./types.js";
const a = path.resolve("native-account-a");
const b = path.resolve("native-account-b");
const cfg: BranchConfig = {
  plugins: {
    entries: {
      anthropic: { config: { nativeAccounts: { defaultConfigDir: b, configDirs: [a, b] } } },
    },
  },
};
const input = (extra: Partial<RunCliAgentParams> = {}): RunCliAgentParams => ({
  sessionId: "branch-session",
  sessionFile: "in-memory",
  sessionManager: SessionManager.inMemory(path.resolve("workspace")),
  workspaceDir: path.resolve("workspace"),
  provider: "claude-cli",
  model: "sonnet",
  prompt: "fixture",
  timeoutMs: 1000,
  runId: "native-admission-fixture",
  config: cfg,
  ...extra,
});
describe("actual CLI preparation rejects ambiguous/removed native ownership before auth or launch", () => {
  it("rejects ownerless forceReuse before downstream auth", async () => {
    await expect(
      prepareCliRunContext(input({ cliSessionBinding: { sessionId: "legacy", forceReuse: true } })),
    ).rejects.toThrow(/no account owner/);
  });
  it("rejects captured ownership when registry disappears", async () => {
    await expect(
      prepareCliRunContext(
        input({ config: {}, cliSessionBinding: { sessionId: "owned", nativeConfigDir: a } }),
      ),
    ).rejects.toThrow(/registry is missing/);
  });
  it("rejects removed owner despite different registered default", async () => {
    const config: BranchConfig = {
      plugins: {
        entries: {
          anthropic: { config: { nativeAccounts: { defaultConfigDir: b, configDirs: [b] } } },
        },
      },
    };
    await expect(
      prepareCliRunContext(
        input({ config, cliSessionBinding: { sessionId: "owned", nativeConfigDir: a } }),
      ),
    ).rejects.toThrow(/no longer registered/);
  });
  it("rejects node placement before transmitting local paths or auth", async () => {
    await expect(
      prepareCliRunContext(
        input({
          sessionEntry: {
            sessionId: "branch-session",
            updatedAt: 0,
            execHost: "node",
            execNode: "fixture-node",
          },
          cliSessionBinding: { sessionId: "owned", nativeConfigDir: a },
        }),
      ),
    ).rejects.toThrow(/remote execution/);
  });
  it("rejects selected Branch profile before profile loading", async () => {
    await expect(prepareCliRunContext(input({ authProfileId: "fixture:api" }))).rejects.toThrow(
      /auth profile overrides/,
    );
  });
});
