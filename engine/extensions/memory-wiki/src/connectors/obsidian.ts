// Adapted from Mintplex-Labs/anything-llm@4bff9da55539978a2a144d4cbda2cdfd87153597 collector/utils/extensions/ObsidianVault/index.js.
// Upstream receives the vault's files from the browser; Branch reads the vault folder from disk.
import fs from "node:fs/promises";
import path from "node:path";
import type { ConnectorDocument, ConnectorSource } from "./import.js";

export type ObsidianVaultFile = { name: string; path: string; content: string };

/** The vault name when every file sits under one top-level folder, else null. */
export function parseObsidianVaultPath(files: readonly ObsidianVaultFile[]): string | null {
  const possiblePaths = new Set<string>();
  for (const file of files) {
    if (file?.path) {
      possiblePaths.add(file.path.split("/")[0] ?? "");
    }
  }
  return possiblePaths.size === 1 ? (possiblePaths.values().next().value ?? null) : null;
}

/** Collects the vault's markdown notes, skipping Obsidian's dot folders (.obsidian, .trash). */
export async function readObsidianVaultFiles(vaultDir: string): Promise<ObsidianVaultFile[]> {
  const root = path.resolve(vaultDir);
  const vaultName = path.basename(root);
  const files: ObsidianVaultFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        files.push({
          name: entry.name,
          path: `${vaultName}/${relative}`,
          content: await fs.readFile(absolute, "utf8"),
        });
      }
    }
  };
  await walk(root);
  return files;
}

export type ObsidianConnectorLoad =
  | { success: true; source: ConnectorSource; documents: ConnectorDocument[] }
  | { success: false; reason: string };

export function loadObsidianVault(
  files: readonly ObsidianVaultFile[],
  vaultDir?: string,
): ObsidianConnectorLoad {
  if (!files || files.length === 0) {
    return { success: false, reason: "No files provided" };
  }
  const vaultName = parseObsidianVaultPath(files);
  const documents: ConnectorDocument[] = [];
  for (const file of files) {
    // A file with no content or only whitespace is skipped.
    if (!file?.content || file.content.trim() === "") {
      continue;
    }
    documents.push({
      key: file.path,
      title: file.name,
      content: file.content,
      url: `obsidian://${file.path}`,
      details: ["- Author: Obsidian Vault"],
    });
  }
  return {
    success: true,
    source: {
      kind: "obsidian",
      id: `obsidian:${vaultDir ? path.resolve(vaultDir) : (vaultName ?? "vault")}`,
      label: vaultName ? `Obsidian Vault "${vaultName}"` : "Obsidian Vault",
    },
    documents,
  };
}
