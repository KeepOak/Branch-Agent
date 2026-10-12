import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { searchContainedGlob, type GlobOperations } from "../../coding/glob-search.js";
import { resolveIdentityPathViaExistingAncestorSync } from "../../infra/boundary-path.js";
import { preserveAtPrefixedRelativePath, resolvePathFromInput } from "../path-policy.js";
import { assertSandboxPath } from "../sandbox-paths.js";
import type { SandboxFsBridge } from "../sandbox/fs-bridge.types.js";
import type { AgentToolWithMeta } from "./common.js";

const GlobSchema = Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) });
const GlobOutputSchema = Type.Object({
  files: Type.Array(Type.String()),
  truncated: Type.Literal(false),
});
export type GlobToolResult = { files: string[]; truncated: false };
type GlobToolOptions = {
  root?: string;
  bridge?: SandboxFsBridge;
  operations?: GlobOperations;
  validatePath?: GlobOperations["validatePath"];
};

function createGlobOperations(cwd: string, options: GlobToolOptions): GlobOperations {
  const bridge = options.bridge;
  if (bridge) {
    return {
      paths: path.posix,
      validatePath: async (filePath, signal) => {
        const stat = await bridge.stat({ filePath, cwd, signal, followSymlinks: true });
        return stat?.canonicalPath;
      },
      readDirectory: async (filePath, signal) => {
        if (!bridge.readDirectory) throw new Error("Sandbox directory listing is unavailable.");
        return bridge.readDirectory({ filePath, cwd, signal });
      },
      stat: (filePath, signal) => bridge.stat({ filePath, cwd, signal, followSymlinks: true }),
    };
  }
  return {
    validatePath: async (filePath, signal) => {
      signal?.throwIfAborted();
      await assertSandboxPath({ filePath, cwd, root: options.root ?? path.parse(filePath).root });
      return resolveIdentityPathViaExistingAncestorSync(filePath);
    },
    readDirectory: async (filePath) =>
      (await fs.readdir(filePath, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      })),
    stat: async (filePath) => {
      const stat = await fs.stat(filePath);
      return {
        type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
        mtimeMs: stat.mtimeMs,
      };
    },
  };
}

export function createGlobTool(
  cwd: string,
  options: GlobToolOptions = {},
): AgentToolWithMeta<typeof GlobSchema, GlobToolResult> {
  const baseOperations = options.operations ?? createGlobOperations(cwd, options);
  const operations: GlobOperations = {
    ...baseOperations,
    validatePath: async (filePath, signal) => {
      await options.validatePath?.(filePath, signal);
      return baseOperations.validatePath(filePath, signal);
    },
  };
  return {
    name: "glob",
    label: "Find files",
    description:
      "Find files by a relative glob pattern, optionally under a path resolved from the coding workspace. Returns every matching path, newest first. Directory links are not traversed and every result follows the existing workspace boundary checks.",
    parameters: GlobSchema,
    outputSchema: GlobOutputSchema,
    execute: async (_callId, input, signal) => {
      const requested = await preserveAtPrefixedRelativePath(
        input.path ?? ".",
        cwd,
        options.bridge,
        signal,
      );
      const root = options.bridge
        ? options.bridge.resolvePath({ filePath: requested, cwd }).containerPath
        : resolvePathFromInput(requested, cwd);
      const files = await searchContainedGlob(root, input.pattern, operations, signal);
      const text = files.length === 0 ? "0 files" : `${files.length} files\n${files.join("\n")}`;
      return { content: [{ type: "text", text }], details: { files, truncated: false } };
    },
  };
}
