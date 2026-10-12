/**
 * Import-side checks for a Trunk template. Export keeps secrets out, but a pasted template, a
 * hand-made link or a file never went through the exporter, so import runs the same secret check
 * before anything is written: persona text, a name or a description that looks like a secret refuses
 * the whole template, and a routine or permission line that does is left out with a warning.
 * Import also binds the template's channels that are set up here, through the same conflict-keeping
 * helper the agents bind command uses, so an existing binding is never taken over.
 */
import { applyAgentBindings } from "../commands/agents.bindings.js";
import { mutateConfigFileWithRetry } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { redactSensitiveText } from "../logging/redact.js";
import { looksSecret } from "./trunk-template-export.js";
import { redactPersonaText, type TrunkTemplate } from "./trunk-template.js";

export const IMPORT_SECRET_REFUSAL =
  "This template's persona, name or description looks like it contains a secret (a token or key), so it was not imported. Remove the secret from the template, then import it again.";
const ROUTINE_SECRET_WARNING =
  "One routine looks like it contains a secret (a token or key), so it was not imported.";
const PERMISSION_SECRET_WARNING =
  "One permission line looks like it contains a secret (a token or key), so it was left out.";

export type ScreenedTrunkTemplate =
  | { ok: true; template: TrunkTemplate; warnings: string[] }
  | { ok: false; error: string };

/** The template with nothing secret-looking left in it, or a refusal when its persona, name or description holds one. */
export function screenImportedTemplate(template: TrunkTemplate): ScreenedTrunkTemplate {
  const fields = [
    template.name,
    template.description,
    template.persona.agentsMd,
    template.persona.soulMd ?? "",
  ];
  if (fields.some((text) => looksSecret(text))) {
    return { ok: false, error: IMPORT_SECRET_REFUSAL };
  }
  const warnings: string[] = [];
  const screened: TrunkTemplate = { ...template };
  if (template.automations) {
    screened.automations = template.automations.filter((routine) => {
      const leaks = [routine.name, routine.cron, routine.prompt].some((text) => looksSecret(text));
      if (leaks) {
        warnings.push(ROUTINE_SECRET_WARNING);
      }
      return !leaks;
    });
  }
  screened.permissions = template.permissions.filter((line) => {
    const leaks = looksSecret(line);
    if (leaks) {
      warnings.push(PERMISSION_SECRET_WARNING);
    }
    return !leaks;
  });
  return { ok: true, template: screened, warnings };
}

export type ConnectionStatus = { id: string; ready: boolean; bound: boolean };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function scrubbedMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return redactSensitiveText(redactPersonaText(text, {}));
}

/** Each channel the template names, and whether this computer has it set up. */
function connectionStatus(cfg: BranchConfig, template: TrunkTemplate): ConnectionStatus[] {
  const channels = record(cfg.channels);
  return (template.connections ?? []).map((id) => {
    const channel = channels[id];
    const ready =
      typeof channel === "object" && channel !== null && record(channel).enabled !== false;
    return { id, ready, bound: false };
  });
}

/**
 * Binds the new Trunk to each of the template's channels that is set up here (channel only: account
 * ids and peers never travel in a template). A channel another Trunk is already bound to keeps that
 * binding and becomes a warning. A failed config write becomes a warning too; the Trunk is kept.
 */
export async function bindReadyChannels(
  cfg: BranchConfig,
  agentId: string,
  template: TrunkTemplate,
): Promise<{ connections: ConnectionStatus[]; warnings: string[] }> {
  const connections = connectionStatus(cfg, template);
  const ready = connections.filter((connection) => connection.ready);
  if (ready.length === 0) {
    return { connections, warnings: [] };
  }
  let outcome: ReturnType<typeof applyAgentBindings> | undefined;
  try {
    await mutateConfigFileWithRetry({
      afterWrite: { mode: "auto" },
      mutate: (draft) => {
        outcome = applyAgentBindings(
          draft,
          ready.map((connection) => ({ agentId, match: { channel: connection.id } })),
        );
        if (outcome.added.length > 0 || outcome.updated.length > 0) {
          draft.bindings = outcome.config.bindings;
        }
      },
    });
  } catch (error) {
    const names = ready.map((connection) => connection.id).join(", ");
    return {
      connections,
      warnings: ["This Trunk was not bound to " + names + ": " + scrubbedMessage(error)],
    };
  }
  const bound = new Set(
    [...(outcome?.added ?? []), ...(outcome?.updated ?? []), ...(outcome?.skipped ?? [])].map(
      (binding) => binding.match.channel,
    ),
  );
  const warnings: string[] = [];
  for (const connection of ready) {
    connection.bound = bound.has(connection.id);
    if (connection.bound) {
      warnings.push(
        "Messages on " +
          connection.id +
          " now go to this Trunk. Change that in the Trunk's connections if you want them to stay with another Trunk.",
      );
    }
  }
  for (const conflict of outcome?.conflicts ?? []) {
    warnings.push(
      'Channel "' +
        conflict.binding.match.channel +
        '" already sends its messages to Trunk "' +
        conflict.existingAgentId +
        '", so this Trunk was not bound to it.',
    );
  }
  return { connections, warnings };
}
