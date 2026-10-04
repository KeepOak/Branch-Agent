// Adapted from cline/cline@0809928ab28783c0d2b41c1e56edaf0951dadcab apps/vscode/src/core/context/context-tracking/FileContextTracker.ts.
// Wires the tracker to Branch's read/edit/write tool hooks and the per-turn prompt build.
import os from "node:os";
import path from "node:path";
import { resolveSessionAgentIdStrict } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchPluginApi } from "branch/plugin-sdk/core";
import { resolveAgentWorkspaceDir } from "branch/plugin-sdk/memory-core-host-engine-foundation";
import type { BranchConfig } from "branch/plugin-sdk/memory-core-host-runtime-core";
import {
  FileContextTracker,
  formatRecentlyModifiedFilesNotice,
  type FileContextOperation,
} from "./file-context-tracker.js";

const TOOL_OPERATIONS: Readonly<Record<string, FileContextOperation>> = {
  read: "read_tool",
  edit: "agent_edited",
  write: "agent_edited",
};

function readToolPath(params: Record<string, unknown>): string | undefined {
  const raw = params.file_path ?? params.path;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function resolveToolPath(rawPath: string, workspaceDir: string): string {
  if (rawPath === "~" || rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(1));
  }
  return path.resolve(workspaceDir, rawPath);
}

function displayPath(absolutePath: string, workspaceDir: string | undefined): string {
  if (!workspaceDir) {
    return absolutePath;
  }
  const relative = path.relative(workspaceDir, absolutePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : absolutePath;
}

/** Registers stale-context tracking for files the agent read or edited. */
export function registerFileContextTracking(api: BranchPluginApi): void {
  const trackers = new Map<string, { tracker: FileContextTracker; workspaceDir?: string }>();
  const currentConfig = () => (api.runtime.config?.current?.() ?? api.config) as BranchConfig;
  const resolveWorkspaceDir = (sessionKey: string, agentId?: string): string | undefined => {
    try {
      const config = currentConfig();
      return resolveAgentWorkspaceDir(
        config,
        resolveSessionAgentIdStrict({ sessionKey, config, agentId }),
      );
    } catch {
      return undefined;
    }
  };
  const disposeSession = (sessionKey: string | undefined) => {
    if (!sessionKey) {
      return;
    }
    trackers.get(sessionKey)?.tracker.dispose();
    trackers.delete(sessionKey);
  };

  api.on("after_tool_call", async (event, ctx) => {
    const operation = TOOL_OPERATIONS[event.toolName];
    const rawPath = operation && !event.error ? readToolPath(event.params) : undefined;
    if (!operation || !rawPath || !ctx.sessionKey) {
      return;
    }
    let state = trackers.get(ctx.sessionKey);
    if (!state) {
      state = {
        tracker: new FileContextTracker(ctx.sessionKey, { resolvePath: (filePath) => filePath }),
        workspaceDir: resolveWorkspaceDir(ctx.sessionKey, ctx.agentId),
      };
      trackers.set(ctx.sessionKey, state);
    }
    const absolutePath = resolveToolPath(rawPath, state.workspaceDir ?? process.cwd());
    await state.tracker.trackFileContext(absolutePath, operation);
  });

  api.on("before_prompt_build", async (_event, ctx) => {
    const state = ctx.sessionKey ? trackers.get(ctx.sessionKey) : undefined;
    if (!state) {
      return undefined;
    }
    await state.tracker.detectExternalChanges();
    const files = state.tracker
      .getAndClearRecentlyModifiedFiles()
      .map((filePath) => displayPath(filePath, state.workspaceDir));
    const prependContext = formatRecentlyModifiedFilesNotice(files);
    return prependContext ? { prependContext } : undefined;
  });

  api.on("session_end", (event, ctx) => {
    disposeSession(event.sessionKey ?? ctx.sessionKey);
  });
  api.on("before_reset", (_event, ctx) => {
    disposeSession(ctx.sessionKey);
  });
}
