import fs from "node:fs/promises";
import path from "node:path";
import {
  ErrorCodes,
  errorShape,
  validateMemoryExportParams,
  type MemoryExportResult,
} from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { AgentSelectionRequiredError } from "../../agents/agent-scope-config.js";
import { formatErrorMessage, isMissingPathError } from "../../infra/errors.js";
import { root } from "../../infra/fs-safe.js";
import { resolveConfiguredAgentIdOrRespondError } from "./agent-id-shared.js";
import type { GatewayRequestHandler } from "./types.js";
import { assertValidParams } from "./validation.js";

export const memoryExportHandler: GatewayRequestHandler = async ({ params, respond, context }) => {
  if (!assertValidParams(params, validateMemoryExportParams, "memory.export", respond)) return;
  const cfg = context.getRuntimeConfig();
  let agentId = params.agentId;
  if (!agentId) {
    try {
      agentId = resolveDefaultAgentId(cfg, {
        surface: "memory export",
        hint: "Pass agentId to select a configured agent.",
      });
    } catch (error) {
      if (!(error instanceof AgentSelectionRequiredError)) throw error;
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
      return;
    }
  }
  const resolvedId = resolveConfiguredAgentIdOrRespondError(agentId, cfg, respond);
  if (!resolvedId) return;
  const workspaceDir = resolveAgentWorkspaceDir(cfg, resolvedId);
  const files: MemoryExportResult["files"] = [];
  try {
    const workspaceRoot = await root(workspaceDir);
    const read = async (relativePath: string) => {
      try {
        const stat = await fs.lstat(path.join(workspaceDir, relativePath));
        if (!stat.isFile() || stat.isSymbolicLink()) return;
        const content = (await workspaceRoot.read(relativePath, { hardlinks: "reject" })).buffer.toString("utf8");
        files.push({ path: relativePath, content });
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
    };
    await read("MEMORY.md");
    const walk = async (relativeDir: string): Promise<void> => {
      let entries;
      try {
        const directory = await fs.lstat(path.join(workspaceDir, relativeDir));
        if (!directory.isDirectory() || directory.isSymbolicLink()) return;
        entries = await fs.readdir(path.join(workspaceDir, relativeDir), { withFileTypes: true });
      } catch (error) {
        if (isMissingPathError(error)) return;
        throw error;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const relativePath = `${relativeDir}/${entry.name}`;
        if (entry.isDirectory()) await walk(relativePath);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) await read(relativePath);
      }
    };
    await walk("memory");
    files.sort((a, b) => a.path.localeCompare(b.path));
    respond(true, { agentId: resolvedId, files }, undefined);
  } catch (error) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(error)));
  }
};
