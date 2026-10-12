import fs from "node:fs/promises";
import { expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { handleSystemAgentCommand } from "./commands-system-agent.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

it("returns protected provider guidance through the channel command without a pending change", async () => {
  await withBranchTestState(
    { label: "provider-guidance", layout: "state-only" },
    async (state) => {
      const cfg: BranchConfig = {
        commands: { text: true, ownerAllowFrom: ["+15555550123"] },
        channels: { whatsapp: { allowFrom: ["+15555550123"] } },
      };
      await state.writeConfig(cfg);
      const context = { From: "+15555550123", SenderId: "+15555550123", AccountId: "fixture" };
      const params = buildCommandTestParams("/branch configure model provider", cfg, context);
      expect(params.command.senderIsOwner).toBe(true);
      expect(params.command.isAuthorizedSender).toBe(true);

      expect(await handleSystemAgentCommand(params, true)).toMatchObject({
        shouldContinue: false,
        reply: { text: expect.stringContaining("Settings → Models → Connect provider") },
      });
      expect(
        await handleSystemAgentCommand(buildCommandTestParams("/branch yes", cfg, context), true),
      ).toMatchObject({
        shouldContinue: false,
        reply: { text: "No pending Branch Agent rescue change is waiting for approval." },
      });
      expect(JSON.parse(await fs.readFile(state.configPath, "utf8"))).toEqual(cfg);
    },
  );
});
