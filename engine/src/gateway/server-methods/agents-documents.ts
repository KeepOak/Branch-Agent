// Library glue; exclusive creation and provider lifetime semantics adapted from agents-files.ts.
import path from "node:path";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { ErrorCodes, errorShape, validateAgentsDocumentsCreateParams } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { getAgentWorkspaceAccess } from "../../agents/workspace-access.js";
import { root, FsSafeError } from "../../infra/fs-safe.js";
import { resolveConfiguredAgentIdOrRespondError } from "./agent-id-shared.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";
import { enqueueWorkspaceFileUpdate } from "./workspace-fs.js";

export const agentsDocumentsHandlers: GatewayRequestHandlers = {
  "agents.documents.create": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateAgentsDocumentsCreateParams, "agents.documents.create", respond)) return;
    const cfg = context.getRuntimeConfig();
    const agentId = resolveConfiguredAgentIdOrRespondError(params.agentId, cfg, respond);
    if (!agentId) return;
    const name = params.name;
    // A portable basename, never a client-selected directory or Windows device path.
    if (!name.trim() || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Document name must be a portable filename"));
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const filePath = `Documents/${name}`;
    const access = getAgentWorkspaceAccess(workspaceDir);
    const assertCurrent = () => {
      if (getAgentWorkspaceAccess(workspaceDir) !== access) throw new Error("Workspace access changed while saving a Library document");
    };
    try {
      const created = await enqueueWorkspaceFileUpdate(async () => {
        assertCurrent();
        if (access) {
          if (!access.bridge.createFileExclusive) throw new Error("This workspace provider cannot safely create a Library document");
          const result = await access.bridge.createFileExclusive({ filePath, data: params.content, mkdir: true });
          assertCurrent();
          return result !== "exists";
        }
        const workspaceRoot = await root(workspaceDir);
        assertCurrent();
        try {
          await workspaceRoot.create(path.posix.join("Documents", name), params.content, { encoding: "utf8", atomic: true, mkdir: true, assertBeforeMutation: assertCurrent });
        } catch (error) {
          if (error instanceof FsSafeError && error.code === "already-exists") return false;
          throw error;
        }
        assertCurrent();
        return true;
      });
      if (!created) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "A document with this name already exists", { details: { type: "document_conflict", path: filePath } }));
        return;
      }
      respond(true, { agentId, file: { name, path: filePath, size: Buffer.byteLength(params.content), hash: sha256Hex(params.content) } });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)));
    }
  },
};
