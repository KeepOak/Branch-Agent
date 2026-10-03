import type { CanopyWorkspace, CanopyWorkspaceAccess } from "@branch/canopy-contract";
import {
  listAgentIds,
  resolveAgentConfig,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "branch/plugin-sdk/agent-runtime";
// Canopy workspace access follows the caller's canonical filesystem boundary.
import {
  canonicalPathFromExistingAncestor,
  isPathInside,
} from "branch/plugin-sdk/file-access-runtime";
import type {
  AnyAgentTool,
  BranchPluginApi,
  BranchPluginToolContext,
} from "branch/plugin-sdk/plugin-entry";
import { asOptionalRecord } from "branch/plugin-sdk/string-coerce-runtime";

export type { CanopyWorkspaceAccess } from "@branch/canopy-contract";

type CanopyConfig = NonNullable<BranchPluginToolContext["config"]>;
type ResolveSandboxWorkspaceAuthority =
  BranchPluginApi["runtime"]["sandbox"]["resolveWorkspaceAuthority"];
type PrepareSandboxWorkspaceAuthority =
  BranchPluginApi["runtime"]["sandbox"]["prepareWorkspaceAuthority"];

export const CANOPY_SESSIONS_BOARD_TOOL_NAMES = [
  "canopy_sessions_board_read",
  "canopy_sessions_board_update",
  "canopy_sessions_board_move",
] as const;

/** Card tools stay optional; sessions-board tools register separately as default-on. */
export const CANOPY_CARD_TOOL_NAMES = [
  "canopy_list",
  "canopy_create",
  "canopy_link",
  "canopy_read",
  "canopy_claim",
  "canopy_heartbeat",
  "canopy_complete",
  "canopy_attachment_add",
  "canopy_attachment_read",
  "canopy_attachment_delete",
  "canopy_block",
  "canopy_boards",
  "canopy_board_create",
  "canopy_board_archive",
  "canopy_board_delete",
  "canopy_stats",
  "canopy_runs",
  "canopy_specify",
  "canopy_decompose",
  "canopy_notify_subscribe",
  "canopy_notify_list",
  "canopy_notify_events",
  "canopy_notify_advance",
  "canopy_notify_unsubscribe",
  "canopy_promote",
  "canopy_reassign",
  "canopy_reclaim",
  "canopy_dispatch",
  "canopy_release",
  "canopy_comment",
  "canopy_proof",
  "canopy_worker_log",
  "canopy_protocol_violation",
  "canopy_unblock",
  "canopy_move",
] as const;

const CANOPY_TOOL_NAMES = [
  ...CANOPY_CARD_TOOL_NAMES,
  ...CANOPY_SESSIONS_BOARD_TOOL_NAMES,
] as const;

export const CANOPY_REQUIRED_WORKER_TOOLS = [
  "canopy_heartbeat",
  "canopy_complete",
  "canopy_block",
] as const;

export function resolveCanopyAgentWorkspace(config: CanopyConfig, agentId?: string): string {
  return resolveAgentWorkspaceDir(config, agentId ?? resolveDefaultAgentId(config));
}

export function resolveConfiguredCanopyWorkspaceAccess(params: {
  config: CanopyConfig;
  unrestricted: boolean;
}): CanopyWorkspaceAccess {
  if (params.unrestricted) {
    return { unrestricted: true };
  }
  return {
    unrestricted: false,
    writable: true,
    roots: listAgentIds(params.config).map((agentId) =>
      resolveAgentWorkspaceDir(params.config, agentId),
    ),
  };
}

export type CanopyTargetWorkspaceRuntime = {
  sandboxed: boolean;
  workspaceAccess: CanopyWorkspaceAccess;
  confinementError?: string;
};

export async function resolveAgentCanopyWorkspaceRuntime(params: {
  config: CanopyConfig;
  agentId?: string;
  sessionKey: string;
  workspaceDir: string;
  modelProvider?: string;
  modelId?: string;
  prepareSandboxWorkspaceAuthority: PrepareSandboxWorkspaceAuthority;
}): Promise<CanopyTargetWorkspaceRuntime> {
  const agentId = params.agentId ?? resolveDefaultAgentId(params.config);
  const sandboxRuntime = await params.prepareSandboxWorkspaceAuthority({
    config: params.config,
    agentId,
    confinedToolNames: CANOPY_TOOL_NAMES,
    requiredToolNames: CANOPY_REQUIRED_WORKER_TOOLS,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    sessionKey: params.sessionKey,
    workspaceDir: params.workspaceDir,
  });
  return {
    sandboxed: sandboxRuntime.sandboxed,
    workspaceAccess: sandboxRuntime.sandboxed
      ? {
          unrestricted: false,
          roots: [resolveAgentWorkspaceDir(params.config, agentId)],
          writable: sandboxRuntime.workspaceAccess === "rw",
        }
      : { unrestricted: true },
    ...(sandboxRuntime.confinementError
      ? { confinementError: sandboxRuntime.confinementError }
      : {}),
  };
}

export function resolveCommandCanopyWorkspaceAccess(params: {
  config: CanopyConfig;
  agentId?: string;
  sessionKey?: string;
  gatewayClientScopes?: readonly string[];
  resolveSandboxWorkspaceAuthority?: ResolveSandboxWorkspaceAuthority;
}): CanopyWorkspaceAccess {
  if (params.gatewayClientScopes) {
    return resolveConfiguredCanopyWorkspaceAccess({
      config: params.config,
      unrestricted: params.gatewayClientScopes.includes("operator.admin"),
    });
  }
  const agentId = params.agentId ?? resolveDefaultAgentId(params.config);
  const sandboxRuntime =
    params.sessionKey && params.resolveSandboxWorkspaceAuthority
      ? params.resolveSandboxWorkspaceAuthority({
          config: params.config,
          agentId,
          sessionKey: params.sessionKey,
        })
      : undefined;
  if (sandboxRuntime?.sandboxed) {
    return {
      unrestricted: false,
      roots: [resolveAgentWorkspaceDir(params.config, agentId)],
      writable: sandboxRuntime.workspaceAccess === "rw",
    };
  }
  const workspaceOnly =
    resolveAgentConfig(params.config, agentId)?.tools?.fs?.workspaceOnly ??
    params.config.tools?.fs?.workspaceOnly;
  return workspaceOnly === true
    ? {
        unrestricted: false,
        roots: [resolveAgentWorkspaceDir(params.config, agentId)],
        writable: true,
      }
    : { unrestricted: true };
}

function resolveToolCanopyWorkspaceAccess(
  context: BranchPluginToolContext | undefined,
  resolveSandboxWorkspaceAuthority?: ResolveSandboxWorkspaceAuthority,
): CanopyWorkspaceAccess {
  if (!context?.sandboxed && context?.fsPolicy?.workspaceOnly !== true) {
    return { unrestricted: true };
  }
  const config = context.runtimeConfig ?? context.getRuntimeConfig?.() ?? context.config;
  const sandboxRuntime =
    context.sandboxed && config && context.sessionKey && resolveSandboxWorkspaceAuthority
      ? resolveSandboxWorkspaceAuthority({
          config,
          agentId: context.agentId,
          sessionKey: context.sessionKey,
        })
      : undefined;
  return {
    unrestricted: false,
    roots: context.workspaceDir ? [context.workspaceDir] : [],
    writable: sandboxRuntime ? sandboxRuntime.workspaceAccess === "rw" : !context.sandboxed,
  };
}

export async function canonicalizeCanopyWorkspaceAccess(
  access: CanopyWorkspaceAccess,
): Promise<CanopyWorkspaceAccess> {
  if (access.unrestricted) {
    return access;
  }
  const roots = Array.from(
    new Set(
      await Promise.all(
        access.roots.map(async (root) => await canonicalPathFromExistingAncestor(root)),
      ),
    ),
  );
  if (roots.length === 0) {
    throw new Error("restricted workspace access has no allowed roots.");
  }
  return { unrestricted: false, roots, writable: access.writable };
}

export function intersectCanopyWorkspaceAccess(
  left: CanopyWorkspaceAccess,
  right: CanopyWorkspaceAccess,
): CanopyWorkspaceAccess {
  if (left.unrestricted) {
    return right;
  }
  if (right.unrestricted) {
    return left;
  }
  const roots = new Set<string>();
  for (const leftRoot of left.roots) {
    for (const rightRoot of right.roots) {
      if (leftRoot === rightRoot || isPathInside(leftRoot, rightRoot)) {
        roots.add(rightRoot);
      } else if (isPathInside(rightRoot, leftRoot)) {
        roots.add(leftRoot);
      }
    }
  }
  if (roots.size === 0) {
    throw new Error("workspace access does not overlap the card's persisted authority.");
  }
  return {
    unrestricted: false,
    roots: Array.from(roots),
    writable: left.writable && right.writable,
  };
}

async function assertCanonicalCanopyPathAccess(
  candidate: string,
  access: CanopyWorkspaceAccess,
): Promise<string> {
  if (access.unrestricted) {
    return candidate;
  }
  for (const root of access.roots) {
    const canonicalRoot = await canonicalPathFromExistingAncestor(root);
    if (isPathInside(canonicalRoot, candidate)) {
      return candidate;
    }
  }
  throw new Error("workspace path is outside the caller's allowed workspaces.");
}

export async function assertCanonicalCanopyRootAccess(
  candidate: string,
  access: CanopyWorkspaceAccess,
): Promise<string> {
  if (access.unrestricted) {
    return candidate;
  }
  for (const root of access.roots) {
    const canonicalRoot = await canonicalPathFromExistingAncestor(root);
    if (canonicalRoot === candidate) {
      return candidate;
    }
  }
  throw new Error("workspace path must equal one of the caller's allowed workspace roots.");
}

async function assertPathAllowed(
  value: unknown,
  access: CanopyWorkspaceAccess,
): Promise<string | undefined> {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const candidate = await canonicalPathFromExistingAncestor(value.trim());
  return await assertCanonicalCanopyPathAccess(candidate, access);
}

async function assertWorkspaceAllowed(
  value: unknown,
  access: CanopyWorkspaceAccess,
  options?: { sourceOnly?: boolean },
): Promise<string | undefined> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const workspace = value as Record<string, unknown>;
  if (options?.sourceOnly) {
    return await assertPathAllowed(workspace.sourcePath ?? workspace.path, access);
  }
  await assertPathAllowed(workspace.path, access);
  await assertPathAllowed(workspace.sourcePath, access);
  return undefined;
}

export function containsCanopyWorkspaceMutation(value: unknown): boolean {
  const record = asOptionalRecord(value);
  if (!record) {
    return false;
  }
  if (Object.hasOwn(record, "workspace") || Object.hasOwn(record, "defaultWorkspace")) {
    return true;
  }
  return (
    containsCanopyWorkspaceMutation(record.patch) ||
    containsCanopyWorkspaceMutation(asOptionalRecord(record.metadata)?.automation) ||
    (Array.isArray(record.children) &&
      record.children.some((child) => containsCanopyWorkspaceMutation(child)))
  );
}

export function withCanopyWorkspaceAccess(
  value: unknown,
  access: CanopyWorkspaceAccess,
): Record<string, unknown> {
  return { ...withoutCanopyWorkspaceAccess(value), workspaceAccess: access };
}

export function withoutCanopyWorkspaceAccess(value: unknown): Record<string, unknown> {
  const record = asOptionalRecord(value) ?? {};
  const { workspaceAccess: _untrustedWorkspaceAccess, ...rest } = record;
  return rest;
}

export function withCanopyDecomposeWorkspaceAccess(
  value: unknown,
  access: CanopyWorkspaceAccess,
): Record<string, unknown> {
  const record = withoutCanopyWorkspaceAccess(value);
  return {
    ...record,
    ...(Array.isArray(record.children)
      ? {
          children: record.children.map((child) => withCanopyWorkspaceAccess(child, access)),
        }
      : {}),
  };
}

export async function assertCanopyWorkspaceMutationAccess(
  value: unknown,
  access: CanopyWorkspaceAccess,
): Promise<void> {
  if (access.unrestricted) {
    return;
  }
  const record = asOptionalRecord(value);
  if (!record) {
    return;
  }
  // Card creation and decomposition persist only explicit workspace fields;
  // board defaults and parent workspaces are metadata, not inherited inputs.
  await assertWorkspaceAllowed(record.workspace, access);
  await assertWorkspaceAllowed(record.defaultWorkspace, access);

  const patch = asOptionalRecord(record.patch);
  if (patch) {
    await assertCanopyWorkspaceMutationAccess(patch, access);
  }
  const metadata = asOptionalRecord(record.metadata);
  const automation = asOptionalRecord(metadata?.automation);
  if (automation) {
    await assertCanopyWorkspaceMutationAccess(automation, access);
  }
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      await assertCanopyWorkspaceMutationAccess(child, access);
    }
  }
}

export async function assertCanopyWorkspaceSourceAccess(
  workspace: CanopyWorkspace | undefined,
  access: CanopyWorkspaceAccess,
): Promise<string | undefined> {
  return await assertWorkspaceAllowed(workspace, access, { sourceOnly: true });
}

export function guardCanopyToolsForWorkspaceAccess(
  tools: AnyAgentTool[],
  context: BranchPluginToolContext | undefined,
  resolveSandboxWorkspaceAuthority?: ResolveSandboxWorkspaceAuthority,
): AnyAgentTool[] {
  const workspaceAccess = resolveToolCanopyWorkspaceAccess(
    context,
    resolveSandboxWorkspaceAuthority,
  );
  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, rawParams, signal, onUpdate) => {
      const canonicalAccess = await canonicalizeCanopyWorkspaceAccess(workspaceAccess);
      await assertCanopyWorkspaceMutationAccess(rawParams, canonicalAccess);
      const sanitizedParams = withoutCanopyWorkspaceAccess(rawParams);
      const constrainedParams =
        tool.name === "canopy_create"
          ? withCanopyWorkspaceAccess(sanitizedParams, canonicalAccess)
          : tool.name === "canopy_decompose"
            ? withCanopyDecomposeWorkspaceAccess(sanitizedParams, canonicalAccess)
            : tool.name === "canopy_specify" &&
                containsCanopyWorkspaceMutation(sanitizedParams)
              ? withCanopyWorkspaceAccess(sanitizedParams, canonicalAccess)
              : sanitizedParams;
      return await tool.execute(toolCallId, constrainedParams, signal, onUpdate);
    },
  }));
}
