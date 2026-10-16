// Library glue; exclusive creation and provider lifetime semantics adapted from agents-files.ts.
import path from "node:path";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { ErrorCodes, errorShape, validateAgentsDocumentsCreateParams, validateAgentsDocumentsSetParams } from "../../../packages/gateway-protocol/src/index.js";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { getAgentWorkspaceAccess } from "../../agents/workspace-access.js";
import { isMissingPathError } from "../../infra/errors.js";
import { root, FsSafeError } from "../../infra/fs-safe.js";
import { resolveConfiguredAgentIdOrRespondError } from "./agent-id-shared.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";
import { enqueueWorkspaceFileUpdate } from "./workspace-fs.js";

/** A Library document the editor saves stays a document, not a dump: 1 MiB of text. */
const MAX_DOCUMENT_BYTES = 1024 * 1024;

/** A portable basename, never a client-selected directory or Windows device path. */
function portableName(name: string) {
  return !(!name.trim() || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name));
}

export const agentsDocumentsHandlers: GatewayRequestHandlers = {
  "agents.documents.create": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateAgentsDocumentsCreateParams, "agents.documents.create", respond)) return;
    const cfg = context.getRuntimeConfig();
    const agentId = resolveConfiguredAgentIdOrRespondError(params.agentId, cfg, respond);
    if (!agentId) return;
    const name = params.name;
    if (!portableName(name)) {
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
  // The Library editor's save: replaces an existing Documents/<name> only while it still holds the text the editor
  // opened, so a Trunk's or another window's edit is never overwritten. It never creates a file; create does that.
  "agents.documents.set": async ({ params, respond, context }) => {
    if (!assertValidParams(params, validateAgentsDocumentsSetParams, "agents.documents.set", respond)) return;
    const cfg = context.getRuntimeConfig();
    const agentId = resolveConfiguredAgentIdOrRespondError(params.agentId, cfg, respond);
    if (!agentId) return;
    const name = params.name;
    if (!portableName(name)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Document name must be a portable filename"));
      return;
    }
    if (Buffer.byteLength(params.content) > MAX_DOCUMENT_BYTES) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Document is too long to save", { details: { type: "document_too_long" } }));
      return;
    }
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const filePath = `Documents/${name}`;
    const expected = params.expectedHash.toLowerCase();
    const access = getAgentWorkspaceAccess(workspaceDir);
    const assertCurrent = () => {
      if (getAgentWorkspaceAccess(workspaceDir) !== access) throw new Error("Workspace access changed while saving a Library document");
    };
    try {
      const outcome = await enqueueWorkspaceFileUpdate(async (): Promise<"saved" | "missing" | "changed"> => {
        assertCurrent();
        if (access) {
          const stat = await access.bridge.stat({ filePath });
          assertCurrent();
          if (!stat) return "missing";
          const data = await access.bridge.readFile({ filePath, maxBytes: MAX_DOCUMENT_BYTES + 1 });
          assertCurrent();
          if (data.length > MAX_DOCUMENT_BYTES || sha256Hex(data) !== expected) return "changed";
          await access.bridge.writeFile({ filePath, data: params.content, mkdir: false });
          assertCurrent();
          return "saved";
        }
        const workspaceRoot = await root(workspaceDir);
        assertCurrent();
        const relative = path.posix.join("Documents", name);
        let current: Buffer;
        try {
          current = (await workspaceRoot.read(relative, { hardlinks: "reject" })).buffer;
        } catch (error) {
          if (isMissingPathError(error)) return "missing";
          throw error;
        }
        assertCurrent();
        if (sha256Hex(current) !== expected) return "changed";
        await workspaceRoot.write(relative, params.content, { encoding: "utf8" });
        assertCurrent();
        return "saved";
      });
      if (outcome === "missing") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "This document no longer exists", { details: { type: "document_missing", path: filePath } }));
        return;
      }
      if (outcome === "changed") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "This document changed since it was opened", { details: { type: "document_changed", path: filePath } }));
        return;
      }
      respond(true, { agentId, file: { name, path: filePath, size: Buffer.byteLength(params.content), hash: sha256Hex(params.content) } });
    } catch (error) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error instanceof Error ? error.message : String(error)));
    }
  },
};
