// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

/** Exact store ids and URLs this scan may keep. Empty until Branch has its own listings. */
export const UPSTREAM_STORE_ALLOWLIST: readonly string[] = [];

function host(parts: readonly string[]): RegExp {
  return new RegExp(parts.join("\\."), "gi");
}

function storePatterns(): RegExp[] {
  return [
    host(["apps", "apple", "com"]),
    host(["itunes", "apple", "com"]),
    host(["play", "google", "com"]),
    host(["chromewebstore", "google", "com"]),
    new RegExp(`${["chrome", "google", "com"].join("\\.")}/webstore`, "gi"),
  ];
}

function storeIds(): string[] {
  return [
    ["6780", "396132"].join(""),
    ["kcdj", "ddhm", "eafe", "omeb", "liik", "mbpb", "lkmk", "foig"].join(""),
    ["ai", "branch", "app"].join("."),
  ];
}

/** Store hosts and ids in `text` that are not on `allowlist`. */
export function upstreamStoreFindings(text: string, allowlist: readonly string[]): string[] {
  const allowed = new Set(allowlist);
  const found = new Set<string>();
  for (const pattern of storePatterns()) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0];
      if (value && !allowed.has(value)) {
        found.add(value);
      }
    }
  }
  for (const id of storeIds()) {
    if (text.includes(id) && !allowed.has(id)) {
      found.add(id);
    }
  }
  return [...found].toSorted();
}

function scanDir(dir: string, allowlist: readonly string[], hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, allowlist, hits);
      continue;
    }
    if (!entry.isFile() || statSync(full).size > 5_000_000) {
      continue;
    }
    const bytes = readFileSync(full);
    if (bytes.includes(0)) {
      continue;
    }
    for (const finding of upstreamStoreFindings(bytes.toString("utf8"), allowlist)) {
      hits.push(`${path.relative(repoRoot, full).split(path.sep).join("/")}: ${finding}`);
    }
  }
}

export function scanUpstreamStores(roots: readonly string[], allowlist: readonly string[]): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    scanDir(root, allowlist, hits);
  }
  return hits.toSorted();
}

describe("upstream store links", () => {
  it("keeps an explicit allowlist and fails on any other app store, Play, or Chrome Web Store id or URL", () => {
    expect(UPSTREAM_STORE_ALLOWLIST).toEqual([]);
    expect(
      scanUpstreamStores(
        [path.join(repoRoot, "desktop"), path.join(repoRoot, "engine", "ui")],
        UPSTREAM_STORE_ALLOWLIST,
      ),
    ).toEqual([]);
  });

  it("reports a store id and URL, and skips the same value when it is allowlisted", () => {
    const hostName = ["apps", "apple", "com"].join(".");
    const id = ["6780", "396132"].join("");
    const url = `https://${hostName}/app/id${id}`;
    expect(upstreamStoreFindings(url, [])).toEqual([id, hostName].toSorted());
    expect(upstreamStoreFindings(url, [hostName, id])).toEqual([]);
  });
});
