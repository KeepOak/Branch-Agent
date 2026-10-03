import fs from "node:fs";
import { expect, it } from "vitest";
import { setRuntimeConfigSnapshot } from "../config/config.js";
import { upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import { hasBranchAgentDatabaseAsyncResources } from "../state/branch-agent-db-resources.js";
import {
  closeBranchAgentDatabaseByPathAsync,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { retainGatewaySessionEntryReadOnly } from "./session-utils-read-lifetime.js";

it.each(["alias replacement", "cold-store close", "same-file reopen"] as const)(
  "rejects a retained metadata read after %s",
  async (change) => {
    await withBranchTestState({ label: "metadata-read-owner" }, async (state) => {
      const originalDirectory = state.statePath("original");
      const replacementDirectory = state.statePath("replacement");
      const aliasDirectory = state.statePath("selected");
      const original = state.statePath("original", "catalog.sqlite");
      const replacement = state.statePath("replacement", "catalog.sqlite");
      const alias = state.statePath("selected", "catalog.sqlite");
      const sessionKey = "agent:main:saved";
      for (const storePath of [original, replacement]) {
        await upsertSessionEntryCore(
          { agentId: "main", storePath, sessionKey },
          {
            sessionId: "identical-session",
            lifecycleRevision: "identical-generation",
            updatedAt: 1,
          },
        );
        // Settle seed workers, then restore the warm handle before testing read lifetime.
        await closeBranchAgentDatabaseByPathAsync(storePath);
        openBranchAgentDatabase({ agentId: "main", path: storePath });
      }
      fs.symlinkSync(originalDirectory, aliasDirectory, "junction");
      const config = {
        agents: { entries: { main: { workspace: state.workspaceDir } } },
        session: { store: alias },
      };
      await state.writeConfig(config);
      setRuntimeConfigSnapshot(config);
      if (change === "cold-store close") {
        await closeBranchAgentDatabaseByPathAsync(original);
      } else if (change === "same-file reopen") {
        openBranchAgentDatabase({ agentId: "main", path: alias });
      }
      const read = retainGatewaySessionEntryReadOnly(sessionKey, "main");
      try {
        expect(read.entry?.sessionId).toBe("identical-session");
        expect(read.isCurrentAtResponse()).toBe(true);
        if (change === "alias replacement") {
          fs.rmSync(aliasDirectory, { recursive: true });
          fs.symlinkSync(replacementDirectory, aliasDirectory, "junction");
        } else {
          await closeBranchAgentDatabaseByPathAsync(read.readSource!.path);
          if (change === "same-file reopen") {
            const successor = retainGatewaySessionEntryReadOnly(sessionKey, "main");
            expect(successor.isCurrentAtResponse()).toBe(true);
            successor.release();
          }
        }
        expect(read.isCurrentAtResponse()).toBe(false);
      } finally {
        read.release();
      }
      expect(read.isCurrent()).toBe(false);
      await closeBranchAgentDatabaseByPathAsync(read.readSource!.path);
      expect(hasBranchAgentDatabaseAsyncResources()).toBe(false);
    });
  },
);
