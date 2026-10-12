import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type {
  CanopyAutomation,
  CanopyDiagnosticAction,
  CanopyWorkspace,
  CanopyWorkspaceAccess,
} from "./types.ts";

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function normalizeWorkspaceAccess(value: unknown): CanopyWorkspaceAccess | undefined {
  if (!isRecord(value) || typeof value.unrestricted !== "boolean") {
    return undefined;
  }
  if (value.unrestricted) {
    return { unrestricted: true };
  }
  if (!Array.isArray(value.roots) || typeof value.writable !== "boolean") {
    return undefined;
  }
  return {
    unrestricted: false,
    roots: value.roots.filter((root): root is string => typeof root === "string"),
    writable: value.writable,
  };
}

export function normalizeAutomation(value: unknown): CanopyAutomation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const workspace = isRecord(value.workspace)
    ? {
        kind:
          value.workspace.kind === "scratch" ||
          value.workspace.kind === "dir" ||
          value.workspace.kind === "worktree"
            ? value.workspace.kind
            : undefined,
        ...(typeof value.workspace.path === "string" ? { path: value.workspace.path } : {}),
        ...(typeof value.workspace.branch === "string" ? { branch: value.workspace.branch } : {}),
        ...(typeof value.workspace.sourcePath === "string"
          ? { sourcePath: value.workspace.sourcePath }
          : {}),
        ...(typeof value.workspace.sourceBranch === "string"
          ? { sourceBranch: value.workspace.sourceBranch }
          : {}),
      }
    : undefined;
  const workspaceAccess = normalizeWorkspaceAccess(value.workspaceAccess);
  const skills = normalizeStringArray(value.skills);
  const createdCardIds = normalizeStringArray(value.createdCardIds);
  const automation: CanopyAutomation = {
    ...(typeof value.tenant === "string" ? { tenant: value.tenant } : {}),
    ...(typeof value.boardId === "string" ? { boardId: value.boardId } : {}),
    ...(typeof value.createdByCardId === "string"
      ? { createdByCardId: value.createdByCardId }
      : {}),
    ...(typeof value.idempotencyKey === "string" ? { idempotencyKey: value.idempotencyKey } : {}),
    ...(skills.length ? { skills } : {}),
    ...(workspace?.kind ? { workspace: workspace as CanopyWorkspace } : {}),
    ...(workspaceAccess ? { workspaceAccess } : {}),
    ...(typeof value.maxRuntimeSeconds === "number"
      ? { maxRuntimeSeconds: value.maxRuntimeSeconds }
      : {}),
    ...(typeof value.maxRetries === "number" ? { maxRetries: value.maxRetries } : {}),
    ...(typeof value.scheduledAt === "number" ? { scheduledAt: value.scheduledAt } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(createdCardIds.length ? { createdCardIds } : {}),
    ...(typeof value.dispatchCount === "number" ? { dispatchCount: value.dispatchCount } : {}),
    ...(typeof value.lastDispatchAt === "number" ? { lastDispatchAt: value.lastDispatchAt } : {}),
  };
  return Object.keys(automation).length ? automation : undefined;
}

export function normalizeDiagnosticAction(value: unknown): CanopyDiagnosticAction | null {
  if (
    !isRecord(value) ||
    (value.kind !== "claim" &&
      value.kind !== "unblock" &&
      value.kind !== "promote" &&
      value.kind !== "reclaim" &&
      value.kind !== "reassign" &&
      value.kind !== "add_proof" &&
      value.kind !== "open_session") ||
    typeof value.label !== "string"
  ) {
    return null;
  }
  return { kind: value.kind, label: value.label };
}
