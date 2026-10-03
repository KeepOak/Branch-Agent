import {
  CANOPY_STATUSES,
  type CanopyCard,
  type CanopyStatus,
} from "@branch/canopy-contract";
import type { BranchPluginApi } from "../api.js";
import { resolveCanopyCardByIdOrPrefix } from "./card-lookup.js";
import type { ResolveAgentWorkspaceRuntime } from "./dispatcher-workspace.js";
import { dispatchAndStartCanopyCards } from "./dispatcher.js";
import type { CanopyStore } from "./store.js";
import {
  canonicalizeCanopyWorkspaceAccess,
  resolveAgentCanopyWorkspaceRuntime,
  resolveCommandCanopyWorkspaceAccess,
  resolveCanopyAgentWorkspace,
  type CanopyWorkspaceAccess,
} from "./workspace-access.js";

const ADMIN_SCOPE = "operator.admin";
const WRITE_SCOPE = "operator.write";

function splitArgs(input: string | undefined): string[] {
  return (input ?? "").trim().split(/\s+/).filter(Boolean);
}

function formatCardLine(card: CanopyCard): string {
  const boardId = card.metadata?.automation?.boardId ?? "default";
  const agent = card.agentId ? ` @${card.agentId}` : "";
  return `${card.id.slice(0, 8)} ${card.status.padEnd(8)} ${card.priority.padEnd(6)} [${boardId}]${agent} ${card.title}`;
}

function formatCardDetails(card: CanopyCard): string {
  const lines = [
    card.title,
    `id: ${card.id}`,
    `status: ${card.status}`,
    `priority: ${card.priority}`,
    `board: ${card.metadata?.automation?.boardId ?? "default"}`,
  ];
  if (card.agentId) {
    lines.push(`agent: ${card.agentId}`);
  }
  if (card.sessionKey) {
    lines.push(`session: ${card.sessionKey}`);
  }
  if (card.runId) {
    lines.push(`run: ${card.runId}`);
  }
  if (card.metadata?.archivedAt) {
    lines.push("archived: yes (excluded from dispatch)");
  }
  if (card.notes) {
    lines.push("", card.notes);
  }
  return lines.join("\n");
}

function isCanopyStatus(value: string): value is CanopyStatus {
  return (CANOPY_STATUSES as readonly string[]).includes(value);
}

function requireWriteAccess(params: {
  senderIsOwner?: boolean;
  gatewayClientScopes?: readonly string[];
}): { text: string; isError: true } | undefined {
  const scopes = params.gatewayClientScopes;
  if (
    scopes
      ? scopes.includes(ADMIN_SCOPE) || scopes.includes(WRITE_SCOPE)
      : params.senderIsOwner === true
  ) {
    return undefined;
  }
  return {
    text: `This command requires gateway scope: ${WRITE_SCOPE}.`,
    isError: true,
  };
}

async function handleCanopyCommand(params: {
  api: Pick<BranchPluginApi, "runtime">;
  store: CanopyStore;
  args?: string;
  senderIsOwner?: boolean;
  assertOwnerCurrent?: () => void;
  gatewayClientScopes?: readonly string[];
  resolveAgentWorkspace?: (agentId?: string) => string;
  resolveAgentWorkspaceRuntime?: ResolveAgentWorkspaceRuntime;
  workspaceAccess?: CanopyWorkspaceAccess;
}): Promise<{ text: string; isError?: boolean }> {
  const [action = "list", ...rest] = splitArgs(params.args);
  if (action === "help") {
    return {
      text: [
        "/canopy list",
        "/canopy show <card-id>",
        "/canopy create <title>",
        "/canopy move <card-id> --status <status>",
        "/canopy dispatch",
      ].join("\n"),
    };
  }
  if (action === "list") {
    const cards = (await params.store.list()).filter((card) => !card.metadata?.archivedAt);
    const rows = cards.slice(0, 12).map(formatCardLine);
    return { text: rows.length ? rows.join("\n") : "No Canopy cards." };
  }
  if (action === "show" || action === "read") {
    const id = rest[0];
    if (!id) {
      return { text: "Usage: /canopy show <card-id>", isError: true };
    }
    const cards = await params.store.list();
    const { card, error } = resolveCanopyCardByIdOrPrefix(cards, id);
    return card ? { text: formatCardDetails(card) } : { text: error, isError: true };
  }
  if (action === "create" || action === "move" || action === "dispatch") {
    const accessError = requireWriteAccess(params);
    if (accessError) {
      return accessError;
    }
  }
  if (action === "create") {
    const title = rest.join(" ").trim();
    if (!title) {
      return { text: "Usage: /canopy create <title>", isError: true };
    }
    const workspaceAccess = await canonicalizeCanopyWorkspaceAccess(
      params.workspaceAccess ?? { unrestricted: true },
    );
    const card = await params.store.create(
      { title, workspaceAccess },
      undefined,
      params.assertOwnerCurrent,
    );
    return { text: `Created ${card.id.slice(0, 8)} ${card.title}` };
  }
  if (action === "move") {
    const id = rest[0];
    const statusIndex = rest.indexOf("--status");
    const status = statusIndex >= 0 ? rest[statusIndex + 1] : undefined;
    if (!id || !status) {
      return {
        text: "Usage: /canopy move <card-id> --status <status>",
        isError: true,
      };
    }
    if (!isCanopyStatus(status)) {
      return {
        text: `status must be one of: ${CANOPY_STATUSES.join(", ")}.`,
        isError: true,
      };
    }
    const cards = await params.store.list();
    const { card, error } = resolveCanopyCardByIdOrPrefix(cards, id);
    if (!card) {
      return { text: error, isError: true };
    }
    return {
      text: formatCardLine(
        await params.store.move(card.id, status, undefined, undefined, {
          assertOwnerCurrent: params.assertOwnerCurrent,
        }),
      ),
    };
  }
  if (action === "dispatch") {
    const workspaceAccess = params.workspaceAccess ?? { unrestricted: true };
    const result = await dispatchAndStartCanopyCards({
      store: params.store,
      subagent: params.api.runtime.subagent,
      worktrees: params.api.runtime.worktrees,
      options: {
        materializeWorktree: true,
        resolveAgentWorkspace: params.resolveAgentWorkspace,
        resolveAgentWorkspaceRuntime: params.resolveAgentWorkspaceRuntime,
        workspaceAccess,
        assertOwnerCurrent: params.assertOwnerCurrent,
      },
    });
    return {
      text: [
        `dispatch: started=${result.started.length} failures=${result.startFailures.length} promoted=${result.promoted.length} blocked=${result.blocked.length}`,
        ...result.started.map((run) => `started ${run.cardId.slice(0, 8)} run=${run.runId}`),
        ...result.startFailures.map(
          (failure) => `failed ${failure.cardId.slice(0, 8)} ${failure.error}`,
        ),
      ].join("\n"),
    };
  }
  return { text: `Unknown Canopy action: ${action}`, isError: true };
}

export function registerCanopyCommand(params: {
  api: BranchPluginApi;
  store: CanopyStore;
}): void {
  params.api.registerCommand({
    name: "canopy",
    description: "List, create, inspect, and dispatch Canopy cards.",
    acceptsArgs: true,
    exposeSenderIsOwner: true,
    handler: async (ctx) =>
      await handleCanopyCommand({
        api: params.api,
        store: params.store,
        args: ctx.args,
        senderIsOwner: ctx.senderIsOwner,
        assertOwnerCurrent: ctx.gatewayClientScopes ? undefined : ctx.assertOwnerCurrent,
        gatewayClientScopes: ctx.gatewayClientScopes,
        resolveAgentWorkspace: (agentId) => resolveCanopyAgentWorkspace(ctx.config, agentId),
        resolveAgentWorkspaceRuntime: (agentId, sessionKey, workspaceDir, modelProvider, modelId) =>
          resolveAgentCanopyWorkspaceRuntime({
            config: ctx.config,
            agentId,
            sessionKey,
            workspaceDir,
            modelProvider,
            modelId,
            prepareSandboxWorkspaceAuthority: params.api.runtime.sandbox.prepareWorkspaceAuthority,
          }),
        workspaceAccess: resolveCommandCanopyWorkspaceAccess({
          config: ctx.config,
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          gatewayClientScopes: ctx.gatewayClientScopes,
          resolveSandboxWorkspaceAuthority: params.api.runtime.sandbox.resolveWorkspaceAuthority,
        }),
      }),
  });
}
