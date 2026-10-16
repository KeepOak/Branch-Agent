// Adapted to Branch's real authorized command; alias and authorization assertions added.
import { beforeEach, expect, it, vi } from "vitest";
import { resolveTextCommand } from "../commands-registry.js";
import {
  buildCompactParams,
  compactEmbeddedAgentSession,
  handleCompactCommand,
  resetCompactCommandMocks,
} from "./commands-compact.test-support.js";
beforeEach(resetCompactCommandMocks);
it.each(["compact", "smol", "newtask"])(
  "runs controller compaction instead of answering the old condense prompt: %s",
  async (alias) => {
    const command = "/" + alias + " Preserve CaseSensitivePath";
    expect(resolveTextCommand(command)?.command.key).toBe("compact");
    vi.mocked(compactEmbeddedAgentSession).mockResolvedValueOnce({ ok: true, compacted: false });
    const params = {
      ...buildCompactParams(command, { commands: { text: true } }),
      sessionEntry: { sessionId: "session-1", updatedAt: 1 },
    };
    const result = await handleCompactCommand(params, true);
    expect(compactEmbeddedAgentSession).toHaveBeenCalledOnce();
    expect(compactEmbeddedAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "manual",
        customInstructions: "Preserve CaseSensitivePath",
      }),
      expect.anything(),
    );
    expect(result?.shouldContinue).toBe(false);
  },
);
it.each(["smol", "newtask"])("uses the shared authorization gate for /%s", async (alias) => {
  const params = buildCompactParams("/" + alias, {});
  params.command.isAuthorizedSender = false;
  const result = await handleCompactCommand(params, true);
  expect(result).toEqual({ shouldContinue: false });
  expect(compactEmbeddedAgentSession).not.toHaveBeenCalled();
});
