import fs from "node:fs/promises";
import path from "node:path";
import type { DirectoryEntry } from "../infra/directory-entries.js";
import { root as fsRoot } from "../infra/fs-safe.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.types.js";
import { getAgentWorkspaceAccess } from "./workspace-access.js";

export type ExternalRulesBridge = Pick<
  SandboxFsBridge,
  "stat" | "readFile" | "readDirectory" | "readFileWithSource"
>;
export type ExternalRuleFiles = {
  stat(relative: string): Promise<"file" | "directory" | undefined>;
  list(relative: string): Promise<DirectoryEntry[]>;
  read(relative: string): Promise<string>;
};
export type ExternalRuleLayout = {
  provider: "cursor" | "windsurf";
  source: string;
  files: string[];
  error?: string;
};

export function isMissingExternalRule(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["ENOENT", "ENOTDIR", "missing", "not-found"].includes(String(error.code))
  );
}

export function externalRulePath(relative: string, posix = process.platform !== "win32"): string {
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    (posix ? relative : relative.replaceAll("\\", "/")).split("/").some((part) => part === "..")
  ) {
    throw new Error("Rule path must stay inside the selected workspace");
  }
  return relative.replace(/^\.\//u, "");
}

async function localCanonical(root: string, relative: string): Promise<string> {
  const canonicalRoot = await fs.realpath(root);
  const canonical = await fs.realpath(path.join(root, externalRulePath(relative)));
  const inside = path.relative(canonicalRoot, canonical);
  if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error("Rule path escapes the selected workspace");
  }
  return canonical;
}

function localFiles(root: string, assertCurrent: () => void): ExternalRuleFiles {
  const handle = () => fsRoot(root);
  return {
    async stat(relative) {
      assertCurrent();
      try {
        const stat = await fs.stat(await localCanonical(root, relative));
        assertCurrent();
        return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : undefined;
      } catch (error) {
        if (isMissingExternalRule(error)) return undefined;
        throw error;
      }
    },
    async list(relative) {
      assertCurrent();
      await localCanonical(root, relative);
      const entries = await (await handle()).list(`./${relative}`, { withFileTypes: true });
      assertCurrent();
      return entries;
    },
    async read(relative) {
      assertCurrent();
      const result = await (
        await handle()
      ).read(`./${externalRulePath(relative)}`, {
        symlinks: "follow-within-root",
        nonBlockingRead: true,
        maxBytes: Infinity,
      });
      assertCurrent();
      return result.buffer.toString("utf8");
    },
  };
}

function bridgeFiles(
  root: string,
  bridge: ExternalRulesBridge,
  assertCurrent: () => void,
): ExternalRuleFiles {
  const request = (relative: string) => ({
    filePath: `./${externalRulePath(relative, root.startsWith("/"))}`,
    cwd: root,
  });
  return {
    async stat(relative) {
      assertCurrent();
      const stat = await bridge.stat({ ...request(relative), followSymlinks: true });
      assertCurrent();
      return stat?.type === "file" || stat?.type === "directory" ? stat.type : undefined;
    },
    async list(relative) {
      if (!bridge.readDirectory)
        throw new Error("Workspace bridge cannot discover rule directories");
      assertCurrent();
      const entries = await bridge.readDirectory(request(relative));
      assertCurrent();
      return entries;
    },
    async read(relative) {
      assertCurrent();
      const source = bridge.readFileWithSource
        ? await bridge.readFileWithSource(request(relative))
        : undefined;
      if (source) {
        if (source.workspaceRelativePath === undefined)
          throw new Error("Rule source is outside the selected workspace mount");
        externalRulePath(source.workspaceRelativePath, root.startsWith("/"));
      }
      const data = source?.data ?? (await bridge.readFile(request(relative)));
      assertCurrent();
      return data.toString("utf8");
    },
  };
}

export function createExternalRuleFiles(params: {
  workspace: string;
  logicalWorkspace?: string;
  bridge?: ExternalRulesBridge;
  assertCurrent?: () => void;
}): ExternalRuleFiles {
  const assertCurrent = params.assertCurrent ?? (() => {});
  const registered = params.bridge
    ? undefined
    : getAgentWorkspaceAccess(params.logicalWorkspace ?? params.workspace);
  const bridge = params.bridge ?? registered?.bridge;
  return bridge
    ? bridgeFiles(params.workspace, bridge, assertCurrent)
    : localFiles(params.workspace, assertCurrent);
}

async function collectDirectory(
  files: ExternalRuleFiles,
  directory: string,
  extension: string,
): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await files.list(directory)) {
    if (!entry.name || entry.name.includes("/") || entry.name === "." || entry.name === "..") {
      throw new Error("Invalid workspace rule directory entry");
    }
    if ([".DS_Store", "Thumbs.db", "desktop.ini"].includes(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory) results.push(...(await collectDirectory(files, relative, extension)));
    else if (
      entry.isFile !== false &&
      (!extension || path.posix.extname(entry.name) === extension)
    ) {
      if ((await files.stat(relative)) === "file") results.push(relative);
    }
  }
  return results;
}

export async function discoverExternalRuleLayouts(
  files: ExternalRuleFiles,
): Promise<ExternalRuleLayout[]> {
  const layouts = [
    { provider: "cursor" as const, source: ".cursor/rules", extension: ".mdc" },
    { provider: "cursor" as const, source: ".cursorrules", extension: "" },
    { provider: "windsurf" as const, source: ".windsurfrules", extension: "" },
  ];
  return Promise.all(
    layouts.map(async ({ provider, source, extension }) => {
      try {
        const stat = await files.stat(source);
        const found =
          stat === "directory"
            ? await collectDirectory(files, source, extension)
            : stat === "file"
              ? [source]
              : [];
        return { provider, source, files: found };
      } catch (error) {
        return { provider, source, files: [], error: String(error) };
      }
    }),
  );
}
