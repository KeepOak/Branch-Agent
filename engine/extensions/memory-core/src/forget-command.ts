// Adapted from QwenLM/qwen-code@728c13de219885de6a3e93223460c3ec8a8f690d packages/cli/src/ui/commands/forgetCommand.ts.
import { resolveSessionAgentIdStrict } from "branch/plugin-sdk/agent-scope-runtime";
import { resolveAgentWorkspaceDir } from "branch/plugin-sdk/memory-core-host-engine-foundation";
import type { PluginCommandContext } from "branch/plugin-sdk/plugin-entry";
import {
  forgetMemoryMatches,
  selectMemoryForgetCandidates,
  type MemoryForgetSelectionModel,
} from "./memory-forget-text.js";
import { lacksAdminOrOwnerForRingsMutation } from "./rings-command.js";

type PluginCommandReply = { text: string };

function createSelectionModel(ctx: PluginCommandContext): MemoryForgetSelectionModel | undefined {
  const llm = ctx.runtimeContext?.llm;
  if (!llm) {
    return undefined;
  }
  // /forget acts on the selection without confirmation, so it uses the session
  // agent's main model (the default) at temperature 0, never a utility model.
  return async ({ prompt, schema, signal }) =>
    (
      await llm.complete({
        messages: [{ role: "user", content: prompt }],
        responseFormat: schema,
        temperature: 0,
        signal,
        purpose: "memory-core.forget-selection",
      })
    ).text;
}

/** Handle /forget: select matching memory entries and remove them from the memory files. */
export async function handleForgetCommand(ctx: PluginCommandContext): Promise<PluginCommandReply> {
  const query = ctx.args?.trim() ?? "";
  if (!query) {
    return { text: "Usage: /forget <memory text to remove>" };
  }
  if (
    lacksAdminOrOwnerForRingsMutation({
      gatewayClientScopes: ctx.gatewayClientScopes,
      senderIsOwner: ctx.senderIsOwner,
    })
  ) {
    return {
      text: "⚠️ /forget requires owner status for channel callers or operator.admin for gateway clients.",
    };
  }
  try {
    const agentId = resolveSessionAgentIdStrict({
      sessionKey: ctx.sessionKey,
      config: ctx.config,
      agentId: ctx.agentId,
    });
    const workspaceDir = resolveAgentWorkspaceDir(ctx.config, agentId);
    const selection = await selectMemoryForgetCandidates(workspaceDir, query, {
      complete: createSelectionModel(ctx),
    });
    ctx.assertOwnerCurrent?.();
    const result = await forgetMemoryMatches(workspaceDir, selection.matches);
    return { text: result.systemMessage ?? `No memory entries matched: ${query}` };
  } catch (error) {
    return {
      text: `Failed to process /forget: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
