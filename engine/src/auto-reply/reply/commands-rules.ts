import { resolveAgentDir } from "../../agents/agent-scope.js";
import {
  inspectExternalProjectRules,
  toggleExternalProjectRule,
} from "../../agents/external-project-rules.js";
import { resolveIngressWorkspaceOverrideForSessionRun } from "../../agents/spawned-context.js";
import {
  commandReply,
  defineAuthorizedTextCommand,
  requireGatewayClientScope,
} from "./command-gates.js";
import { parseRulesCommand } from "./commands-rules.parse.js";
import type { CommandHandler, HandleCommandsParams } from "./commands-types.js";

function ruleOptions(params: HandleCommandsParams) {
  const entry = params.sessionEntry;
  const workspace =
    resolveIngressWorkspaceOverrideForSessionRun({
      spawnedBy: entry?.spawnedBy,
      workspaceDir: entry?.spawnedWorkspaceDir,
      cwd: entry?.spawnedCwd,
    }) ?? params.workspaceDir;
  return { workspace, agentDir: params.agentDir ?? resolveAgentDir(params.cfg, params.agentId) };
}

async function listRules(params: HandleCommandsParams) {
  const options = ruleOptions(params);
  const { layouts, state } = await inspectExternalProjectRules(options);
  const lines = [`External project rules for ${options.workspace}`];
  for (const layout of layouts) {
    if (layout.error) lines.push(`${layout.source}: unavailable (${layout.error})`);
    for (const relative of layout.files) {
      lines.push(
        `${layout.provider}: ${state[layout.provider][relative] ? "on" : "off"} ${relative}`,
      );
    }
  }
  if (lines.length === 1) lines.push("No Cursor or Windsurf rules found.");
  lines.push(
    "Toggle: /rules cursor|windsurf on|off <relative rule path>. Changes apply to the next turn.",
  );
  return commandReply(lines.join("\n"));
}

export const handleRulesCommand: CommandHandler = defineAuthorizedTextCommand(
  {
    label: "/rules",
    match: parseRulesCommand,
    ownerOnly: (_params, command) => command.action === "toggle",
  },
  async (params, command) => {
    if (command.action === "error") return commandReply(command.message);
    try {
      if (command.action === "list") return await listRules(params);
      const denied = requireGatewayClientScope(params, {
        label: "/rules write",
        allowedScopes: ["operator.admin"],
        missingText: "/rules on|off requires operator.admin for Gateway clients.",
      });
      if (denied) return denied;
      const assertCurrent = () => {
        params.commandInvocationSignal?.throwIfAborted();
        params.command.assertOwnerCurrent?.();
      };
      await toggleExternalProjectRule(
        { ...ruleOptions(params), assertCurrent },
        command.provider,
        command.path,
        command.enabled,
      );
      return commandReply(
        `${command.provider} rule ${command.path}: ${command.enabled ? "on" : "off"}. Changes apply to the next turn.`,
      );
    } catch (error) {
      return commandReply(`External project rules unavailable: ${String(error)}`);
    }
  },
);
