// Gateway agent list projection.
// Combines configured agents and existing on-disk agent state for lightweight UI use.
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { listAgentEntries, tryResolveDefaultAgentId } from "../agents/agent-scope.js";
import { tryResolveLegacyCompatibilityAgentId } from "../config/legacy.default-agent-owner.js";
import { resolveStateDir } from "../config/paths.js";
import type { SessionScope } from "../config/sessions.js";
import type { BranchConfig } from "../config/types.branch.js";
import { normalizeAgentId, normalizeMainKey } from "../routing/session-key.js";
import type { GatewayAgentKind } from "../shared/session-types.js";
import {
  readAgentDatabaseAdmissionRefusal,
  type AgentDatabaseAdmissionRefusal,
} from "../state/agent-database-admission.js";
import { SYSTEM_AGENT_ROSTER_ENTRIES } from "../system-agent/agent-id.js";

type GatewayAgentListRow = {
  id: string;
  status?: "degraded";
  admissionRefusal?: AgentDatabaseAdmissionRefusal;
  kind?: GatewayAgentKind;
  name?: string;
};

export type GatewayAgentOwnership = "sole" | "legacy" | "explicit";

type GatewayAgentSelectionState = {
  defaultId: string;
  ownership: GatewayAgentOwnership;
  selectionRequired: boolean;
};

export async function listExistingAgentIdsFromDisk(): Promise<string[]> {
  const agentsDir = path.join(resolveStateDir(), "agents");
  try {
    return (await fs.readdir(agentsDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeAgentId(entry.name));
  } catch {
    return [];
  }
}

export function resolveGatewayAgentSelectionState(cfg: BranchConfig): GatewayAgentSelectionState {
  const configuredIds = listAgentEntries(cfg).map((entry) => normalizeAgentId(entry.id));
  // A fresh normal-profile install has an internal compatibility owner but no contact yet.
  if (cfg.agents?.ownership === "explicit" && configuredIds.length === 0) {
    return { defaultId: "main", ownership: "explicit", selectionRequired: true };
  }
  const contactDefault = cfg.agents?.defaultId && normalizeAgentId(cfg.agents.defaultId);
  if (contactDefault && configuredIds.includes(contactDefault)) {
    return { defaultId: contactDefault, ownership: "explicit", selectionRequired: false };
  }
  const soleAgentId = tryResolveDefaultAgentId(cfg);
  if (soleAgentId) {
    return {
      defaultId: normalizeAgentId(soleAgentId),
      ownership: "sole",
      selectionRequired: false,
    };
  }
  const legacyAgentId = tryResolveLegacyCompatibilityAgentId(cfg);
  const legacyCompatibleId = legacyAgentId ?? configuredIds[0];
  if (!legacyCompatibleId) {
    throw new Error("Cannot project gateway agent ownership without a configured agent.");
  }
  const defaultId = normalizeAgentId(legacyCompatibleId);
  return {
    defaultId,
    ownership: legacyAgentId && cfg.agents?.ownership !== "explicit" ? "legacy" : "explicit",
    selectionRequired: !legacyAgentId,
  };
}

/** Lists gateway-visible agents with canonical membership, ordering, and semantic kind. */
export async function listGatewayAgentsBasic(cfg: BranchConfig): Promise<
  GatewayAgentSelectionState & {
    mainKey: string;
    scope: SessionScope;
    agents: GatewayAgentListRow[];
  }
> {
  const ownerEntries = new Map(
    SYSTEM_AGENT_ROSTER_ENTRIES.map((entry) => [normalizeAgentId(entry.id), entry] as const),
  );
  const selection = resolveGatewayAgentSelectionState(cfg);
  const defaultId = selection.defaultId;
  const mainKey = normalizeMainKey(cfg.session?.mainKey);
  const scope = cfg.session?.scope ?? "per-sender";
  const configuredById = new Map<string, string | undefined>();
  const firstContactBootstrap = cfg.agents?.ownership === "explicit" && listAgentEntries(cfg).length === 0;
  const diskIds = new Set<string>();
  const agentIds = new Set<string>();
  agentIds.add(normalizeAgentId(defaultId));

  for (const entry of listAgentEntries(cfg)) {
    if (!entry?.id) {
      continue;
    }
    const id = normalizeAgentId(entry.id);
    const configuredName = normalizeOptionalString(entry.name);
    const identityName = normalizeOptionalString(entry.identity?.name);
    configuredById.set(id, configuredName ?? identityName);
    agentIds.add(id);
  }

  for (const id of await listExistingAgentIdsFromDisk()) {
    diskIds.add(id);
    if (!firstContactBootstrap) agentIds.add(id);
  }

  const allowedIds = configuredById.size > 0 ? configuredById : null;
  const visibleIds = [...agentIds].filter(
    (id) =>
      !allowedIds ||
      allowedIds.has(id) ||
      // System agents are a separate negotiated surface, not authored roster members.
      (diskIds.has(id) && ownerEntries.has(id)),
  );
  visibleIds.sort((a, b) => a.localeCompare(b));
  const orderedIds =
    defaultId && visibleIds.includes(defaultId)
      ? [defaultId, ...visibleIds.filter((id) => id !== defaultId)]
      : visibleIds;
  if (mainKey && !firstContactBootstrap && !orderedIds.includes(mainKey) && (!allowedIds || allowedIds.has(mainKey))) {
    orderedIds.push(mainKey);
  }

  const agents: GatewayAgentListRow[] = orderedIds.map((id) => {
    const admissionRefusal = readAgentDatabaseAdmissionRefusal(id);
    const agent: GatewayAgentListRow = {
      id,
      kind:
        firstContactBootstrap && id === defaultId
          ? "system"
          : !configuredById.has(id) && diskIds.has(id)
          ? (ownerEntries.get(id)?.kind ?? "agent")
          : "agent",
      name: configuredById.get(id),
    };
    if (admissionRefusal) {
      agent.status = "degraded";
      agent.admissionRefusal = admissionRefusal;
    }
    return agent;
  });
  return { ...selection, mainKey, scope, agents };
}
