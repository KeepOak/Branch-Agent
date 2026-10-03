/** Lists retained process warnings and current plugin diagnostics for the owner. */
import { redactSensitiveText } from "../../logging/redact.js";
import { readRetainedWarnings, type RetainedWarning } from "../../logging/retained-warnings.js";
import { getPluginRegistryForContext } from "../../plugins/runtime/gateway-request-scope.js";
import { commandReply, defineAuthorizedTextCommand } from "./command-gates.js";
import {
  buildPrivateCommandApprovalRequest,
  deliverPrivateCommandReply,
  resolvePrivateCommandRouteTargets,
} from "./commands-private-route.js";
import type { HandleCommandsParams } from "./commands-types.js";

function pluginWarnings(): RetainedWarning[] {
  const registry = getPluginRegistryForContext();
  const timestamp = Date.now();
  const entries: RetainedWarning[] = (registry?.diagnostics ?? [])
    .filter((entry) => entry.level === "warn" || entry.level === "error")
    .map((entry) => ({
      severity: entry.level === "warn" ? "warning" : "error",
      message: redactSensitiveText(entry.message),
      source: redactSensitiveText(entry.pluginId ?? "plugins"),
      timestamp,
    }));
  for (const plugin of registry?.plugins ?? []) {
    if (plugin.status !== "error" || !plugin.error) {
      continue;
    }
    const message = redactSensitiveText(plugin.error);
    const source = redactSensitiveText(plugin.id);
    if (!entries.some((entry) => entry.source === source && entry.message === message)) {
      entries.push({ severity: "error", message, source, timestamp });
    }
  }
  return entries;
}

function warningsText(): string {
  const report = readRetainedWarnings(pluginWarnings());
  if (!report.diagnostics.length) {
    return "No retained warnings or plugin errors.";
  }
  const lines = report.diagnostics.map(
    (entry) =>
      `- ${new Date(entry.timestamp).toISOString()} [${entry.severity}] ${entry.source}: ${entry.message}${entry.stack ? `\n${entry.stack}` : ""}`,
  );
  return [`${report.warningCount} warnings, ${report.errorCount} errors`, ...lines].join("\n");
}

async function privateWarningsReply(params: HandleCommandsParams, text: string) {
  const targets = await resolvePrivateCommandRouteTargets({
    commandParams: params,
    request: buildPrivateCommandApprovalRequest({
      commandParams: params,
      id: "warnings-private-route",
      command: "/warnings",
      agentId: params.agentId,
      createdAtMs: Date.now(),
    }),
  });
  const outcome = await deliverPrivateCommandReply({
    commandParams: params,
    targets,
    reply: { text },
  });
  const messages = {
    delivered: "I sent the warnings to the owner privately.",
    pending: "Private warning delivery is pending; receipt is not confirmed yet.",
    suppressed: "Private warning delivery was suppressed.",
    failed: "No private owner route is available. Run /warnings in an owner DM.",
  };
  return commandReply(messages[outcome]);
}

export const handleWarningsCommand = defineAuthorizedTextCommand(
  { label: "/warnings", match: (body) => (body === "/warnings" ? true : null), ownerOnly: true },
  async (params) => {
    const text = warningsText();
    return params.isGroup ? await privateWarningsReply(params, text) : commandReply(text);
  },
);
