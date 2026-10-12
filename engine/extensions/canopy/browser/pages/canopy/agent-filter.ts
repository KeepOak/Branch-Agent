import { normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";
import type { AgentsListResult } from "../../api/types.ts";
import { t } from "../../i18n/index.ts";
import { listSelectableAgents } from "../../lib/agents/display.ts";
import type { CanopyCard, CanopyUiState } from "../../lib/canopy/index.ts";

export type CanopyAgentsList = Pick<AgentsListResult, "defaultId" | "agents">;
type CanopyAgentRow = AgentsListResult["agents"][number];
type CanopyConfiguredAgentOption = { id: string; label: string; isDefault: boolean };
type CanopyAgentFilterOption = {
  id: CanopyUiState["agentFilter"];
  label: string;
  description?: string;
};

export function agentDisplayName(agent: CanopyAgentRow | undefined, fallback: string): string {
  return agent?.name ?? agent?.identity?.name ?? agent?.id ?? fallback;
}

function cardAgentId(card: CanopyCard, agentsList: CanopyAgentsList | null): string {
  return card.agentId?.trim() || agentsList?.defaultId || "";
}

export function findCardAgent(card: CanopyCard, agentsList: CanopyAgentsList | null) {
  const id = cardAgentId(card, agentsList);
  return id ? agentsList?.agents.find((agent) => agent.id === id) : undefined;
}

export function cardAgentLabel(
  card: CanopyCard,
  agentsList: CanopyAgentsList | null,
): string {
  const fallback = card.agentId?.trim() || t("canopy.defaultAgent");
  return agentDisplayName(findCardAgent(card, agentsList), fallback);
}

export function matchesAgentFilter(
  card: CanopyCard,
  filter: CanopyUiState["agentFilter"],
): boolean {
  if (filter === "all") {
    return true;
  }
  const explicitAgentId = card.agentId?.trim();
  if (filter === "default") {
    return !explicitAgentId;
  }
  return explicitAgentId === filter;
}

export function matchesAgentScope(
  card: Pick<CanopyCard, "agentId">,
  defaultAgentId: string | null | undefined,
  agentId: string | null | undefined,
): boolean {
  if (!agentId) {
    return true;
  }
  const explicitAgentId = card.agentId?.trim();
  return explicitAgentId === agentId || (!explicitAgentId && defaultAgentId === agentId);
}

function buildConfiguredAgentOptions(
  agentsList: CanopyAgentsList | null,
): CanopyConfiguredAgentOption[] {
  const seen = new Set<string>();
  const defaultAgentId = normalizeOptionalString(agentsList?.defaultId) ?? "";
  const options: CanopyConfiguredAgentOption[] = [];
  for (const agent of agentsList?.agents ?? []) {
    const id = normalizeOptionalString(agent.id) ?? "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    options.push({
      id,
      label: agentDisplayName(agent, id),
      isDefault: Boolean(defaultAgentId && id === defaultAgentId),
    });
  }
  return options;
}

function defaultAgentFilterLabel(configuredAgents: readonly CanopyConfiguredAgentOption[]) {
  return configuredAgents.find((agent) => agent.isDefault)?.label ?? t("canopy.defaultAgent");
}

export function buildAgentFilterOptions(
  agentsList: CanopyAgentsList | null,
  cards: readonly CanopyCard[],
) {
  const configuredAgents = buildConfiguredAgentOptions(agentsList);
  const configuredIds = new Set(configuredAgents.map((agent) => agent.id));
  const cardAgentIds = [
    ...new Set(
      cards
        .map((card) => normalizeOptionalString(card.agentId) ?? "")
        .filter((id) => id && !configuredIds.has(id)),
    ),
  ].toSorted((left, right) => left.localeCompare(right));
  const options: CanopyAgentFilterOption[] = [
    { id: "all", label: t("canopy.allAgents") },
    {
      id: "default",
      label: t("canopy.agentFilterUnassigned", {
        agent: defaultAgentFilterLabel(configuredAgents),
      }),
      description: t("canopy.agentFilterUnassignedHelp"),
    },
  ];
  for (const agent of configuredAgents) {
    options.push({
      id: agent.id,
      label: agent.isDefault
        ? t("canopy.agentFilterConfiguredDefault", { agent: agent.label })
        : agent.label,
      ...(agent.isDefault ? { description: t("canopy.agentFilterConfiguredDefaultHelp") } : {}),
    });
  }
  for (const id of cardAgentIds) {
    options.push({ id, label: t("canopy.agentCurrentUnconfigured", { agent: id }) });
  }
  return options;
}

function buildAssignableAgentOptions(
  agentsList: CanopyAgentsList | null,
  currentAgentId: string,
) {
  const selectableList = agentsList
    ? { ...agentsList, agents: listSelectableAgents(agentsList.agents) }
    : null;
  const configuredAgents = buildConfiguredAgentOptions(selectableList);
  const currentId = normalizeOptionalString(currentAgentId) ?? "";
  const currentIsSystem = agentsList?.agents.some(
    (agent) => agent.id === currentId && agent.kind === "system",
  );
  const hasCurrent = currentId
    ? configuredAgents.some((agent) => agent.id === currentId) || currentIsSystem
    : true;
  return [
    {
      id: "",
      label: t("canopy.agentFilterUnassigned", {
        agent: defaultAgentFilterLabel(configuredAgents),
      }),
    },
    ...configuredAgents.map((agent) => ({
      id: agent.id,
      label: agent.isDefault
        ? t("canopy.agentFilterConfiguredDefault", { agent: agent.label })
        : agent.label,
    })),
    ...(hasCurrent
      ? []
      : [{ id: currentId, label: t("canopy.agentCurrentUnconfigured", { agent: currentId }) }]),
  ];
}

export function normalizeActiveAgentFilter(
  options: readonly CanopyAgentFilterOption[],
  filter: CanopyUiState["agentFilter"],
): CanopyUiState["agentFilter"] {
  return options.some((option) => option.id === filter) ? filter : "all";
}

export function buildAssignableAgentPickerOptions(
  agentsList: CanopyAgentsList | null,
  currentAgentId: string,
  defaultAgentId = agentsList?.defaultId ?? "",
) {
  return buildAssignableAgentOptions(agentsList, currentAgentId).map((option) => {
    const effectiveId = option.id || defaultAgentId;
    const agent = agentsList?.agents.find((entry) => entry.id === effectiveId);
    return {
      value: option.id,
      label: agentDisplayName(agent, option.id ? option.label : defaultAgentId || option.label),
      badge: !option.id && defaultAgentId ? t("canopy.defaultAgentBadge") : undefined,
      agent: effectiveId ? (agent ?? { id: effectiveId }) : undefined,
      icon: effectiveId ? undefined : ("bot" as const),
    };
  });
}
