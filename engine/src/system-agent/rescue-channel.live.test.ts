// Branch Agent live rescue channel tests cover live-channel rescue message delivery.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import { clearConfigCache } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { listSystemAgentAuditEntriesForTests } from "./audit.test-support.js";
import { runSystemAgentRescueMessage } from "./rescue-message.js";

const originalStateDir = process.env.BRANCH_STATE_DIR;
const originalConfigPath = process.env.BRANCH_CONFIG_PATH;

const runLive =
  isTruthyEnvValue(process.env.BRANCH_LIVE_TEST) &&
  isTruthyEnvValue(process.env.BRANCH_LIVE_SYSTEM_AGENT_RESCUE_CHANNEL);
const describeLive = runLive ? describe : describe.skip;

function commandContext(channel = process.env.BRANCH_LIVE_SYSTEM_AGENT_CHANNEL ?? "whatsapp") {
  return {
    surface: channel,
    channel,
    channelId: channel,
    ownerList: ["user:owner"],
    senderIsOwner: true,
    isAuthorizedSender: true,
    senderId: "user:owner",
    rawBodyNormalized: "/branch status",
    commandBodyNormalized: "/branch status",
    from: "user:owner",
    to: "account:default",
  } satisfies CommandContext;
}

async function runRescue(params: {
  commandBody: string;
  cfg: BranchConfig;
  ctx?: CommandContext;
}) {
  const ctx = params.ctx ?? commandContext();
  return await runSystemAgentRescueMessage({
    cfg: params.cfg,
    command: { ...ctx, commandBodyNormalized: params.commandBody },
    commandBody: params.commandBody,
    isGroup: false,
  });
}

describeLive("Branch Agent live rescue channel smoke", () => {
  afterEach(() => {
    resetPluginStateStoreForTests();
    clearConfigCache();
    if (originalStateDir === undefined) {
      deleteTestEnvValue("BRANCH_STATE_DIR");
    } else {
      setTestEnvValue("BRANCH_STATE_DIR", originalStateDir);
    }
    if (originalConfigPath === undefined) {
      deleteTestEnvValue("BRANCH_CONFIG_PATH");
    } else {
      setTestEnvValue("BRANCH_CONFIG_PATH", originalConfigPath);
    }
  });

  it("handles /branch status and a persistent approval roundtrip", async () => {
    await withTestDir({ prefix: "branch-live-rescue-" }, async (tempDir) => {
      const configPath = path.join(tempDir, "branch.json");
      setTestEnvValue("BRANCH_STATE_DIR", tempDir);
      setTestEnvValue("BRANCH_CONFIG_PATH", configPath);
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            meta: { lastTouchedVersion: "live-test", lastTouchedAt: new Date(0).toISOString() },
            agents: { defaults: {} },
            tools: { exec: { mode: "full" } },
          },
          null,
          2,
        ),
      );

      const cfg: BranchConfig = {
        tools: { exec: { mode: "full" } },
      };

      await expect(runRescue({ commandBody: "/branch status", cfg })).resolves.toContain(
        "[branch] done: status.check",
      );
      await expect(
        runRescue({ commandBody: "/branch set default model openai/gpt-5.5", cfg }),
      ).resolves.toContain("Reply /branch yes to apply");
      await expect(runRescue({ commandBody: "/branch yes", cfg })).resolves.toContain(
        "Default model: openai/gpt-5.5",
      );

      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as BranchConfig;
      const defaultModel = config.agents?.defaults?.model;
      if (!defaultModel || typeof defaultModel !== "object") {
        throw new Error("expected default model object");
      }
      expect(defaultModel.primary).toBe("openai/gpt-5.5");
      expect(
        listSystemAgentAuditEntriesForTests().some(
          (entry) => entry.value.operation === "config.setDefaultModel",
        ),
      ).toBe(true);
    });
  });
});
