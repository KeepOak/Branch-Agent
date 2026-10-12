import syncFs from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "./config.js";
import { createConfigIO } from "./io.factory.js";
import { withTempHome, withTempHomeConfig, writeBranchConfig } from "./test-helpers.js";
import type { BranchConfig } from "./types.js";
import { validateConfigObject } from "./validation.js";

describe("multi-agent agentDir validation", () => {
  it("validates one referenced agent without resolving its filesystem identity", () => {
    const agentDir = path.join(tmpdir(), "branch-single-agentdir");
    using realpath = vi.spyOn(syncFs.realpathSync, "native");

    const result = validateConfigObject({
      agents: {
        entries: { alpha: { agentDir } },
      },
      bindings: [{ agentId: "alpha", match: { channel: "forum" } }],
    });

    expect(result.ok).toBe(true);
    expect(realpath.mock.calls.filter(([target]) => target === agentDir)).toEqual([]);
  });

  it.each(["BRANCH_HOME", "homedir", "relative BRANCH_HOME"] as const)(
    "keeps config validation and runtime paths in the selected %s",
    async (homeSource) => {
      await withTempHome(async (cliHome) => {
        const daemonHome = path.join(cliHome, "daemon");
        const daemonShared = path.join(daemonHome, "shared");
        const cliShared = path.join(cliHome, "shared");
        await fs.mkdir(daemonShared, { recursive: true });
        await fs.mkdir(cliShared);
        const env: NodeJS.ProcessEnv =
          homeSource === "homedir"
            ? {}
            : homeSource === "relative BRANCH_HOME"
              ? { BRANCH_HOME: "~/daemon" }
              : { [homeSource]: daemonHome };
        const config: BranchConfig = {
          agents: {
            ownership: "explicit",
            entries: { a: { agentDir: "~/shared" }, b: { agentDir: cliShared } },
          },
        };
        const configPath = await writeBranchConfig(daemonHome, config);
        const raw = await fs.readFile(configPath, "utf8");
        const io = createConfigIO({
          configPath,
          env,
          homedir: homeSource === "relative BRANCH_HOME" ? undefined : () => daemonHome,
          observe: false,
          pluginValidation: "core-only",
          logger: { error: vi.fn(), warn: vi.fn() },
        });

        const snapshot = await io.readConfigFileSnapshot();
        expect(snapshot.valid, JSON.stringify(snapshot.issues)).toBe(true);
        const expected = { a: { agentDir: daemonShared }, b: { agentDir: cliShared } };
        expect(snapshot.runtimeConfig.agents?.entries).toEqual(expected);
        expect(io.loadConfig().agents?.entries).toEqual(expected);
        expect(snapshot.sourceConfig.agents?.entries).toEqual(config.agents?.entries);
        await expect(fs.readFile(configPath, "utf8")).resolves.toBe(raw);

        await writeBranchConfig(daemonHome, {
          agents: {
            ownership: "explicit",
            entries: { a: { agentDir: "~/shared" }, b: { agentDir: daemonShared } },
          },
        });
        const collision = await io.readConfigFileSnapshot();
        expect(collision.valid).toBe(false);
        expect(collision.issues).toContainEqual({
          path: "agents.entries",
          message: expect.stringContaining("Duplicate agentDir"),
        });
        expect(() => io.loadConfig()).toThrow(/Duplicate agentDir/);
      });
    },
  );

  it("throws on shared agentDir during getRuntimeConfig()", async () => {
    await withTempHomeConfig(
      {
        agents: {
          ownership: "explicit",
          entries: {
            a: { agentDir: "~/.branch/agents/shared/agent" },
            b: { agentDir: "~/.branch/agents/shared/agent" },
          },
        },
        bindings: [{ agentId: "a", match: { channel: "forum" } }],
      },
      async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => getRuntimeConfig()).toThrow(/duplicate agentDir/i);
        expect(spy.mock.calls.flat().join(" ")).toMatch(/Duplicate agentDir/i);
        spy.mockRestore();
      },
    );
  });
});
