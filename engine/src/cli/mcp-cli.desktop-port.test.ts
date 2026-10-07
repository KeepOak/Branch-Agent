// `branch mcp serve` started by the desktop's branch command (desktop/src/desktop-controls.ts) follows the port an
// in-place update moves the engine to. Kept apart from mcp-cli.test.ts so the PR's named CI list runs only this.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../config/home-env.test-harness.js";
import {
  cleanupMcpCliTestState,
  createWorkspace,
  resetMcpCliTestState,
  runMcpCommand,
  serveBranchChannelMcp,
} from "./mcp-cli.test-harness.js";

async function withMcpHome(run: (home: string, workspaceDir: string) => Promise<void>) {
  await withTempHome("branch-cli-mcp-home-", async (home) => {
    const workspaceDir = await createWorkspace();
    vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);
    await run(home, workspaceDir);
  });
}

describe("mcp serve through the desktop's branch command", () => {
  beforeEach(() => {
    resetMcpCliTestState();
  });

  afterEach(async () => {
    await cleanupMcpCliTestState();
  });

  it("follows the desktop's live port when started by the desktop's branch command", async () => {
    await withMcpHome(async (_home, workspaceDir) => {
      const dataDir = path.join(workspaceDir, "desktop-data");
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, "gateway-token"), "desktop-token\n", "utf-8");
      await fs.writeFile(path.join(dataDir, "gateway-port"), "40123", "utf-8");
      const saved = { ...process.env };
      // As the branch shim: the desktop's own token and data folder, and the port that was live when it ran.
      Object.assign(process.env, {
        BRANCH_GATEWAY_TOKEN: "desktop-token",
        BRANCH_GATEWAY_PORT: "19031",
        BRANCH_DATA: dataDir,
      });
      try {
        await runMcpCommand(["mcp", "serve"]);
      } finally {
        for (const key of ["BRANCH_GATEWAY_TOKEN", "BRANCH_GATEWAY_PORT", "BRANCH_DATA"]) {
          if (saved[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = saved[key];
          }
        }
      }
      const options = serveBranchChannelMcp.mock.calls.at(-1)?.[0] as {
        resolveGatewayUrl?: () => string | undefined;
      };
      expect(options.resolveGatewayUrl?.()).toBe("ws://127.0.0.1:40123");
      await fs.writeFile(path.join(dataDir, "gateway-port"), "40124", "utf-8");
      expect(options.resolveGatewayUrl?.()).toBe("ws://127.0.0.1:40124");
    });
  });
});
