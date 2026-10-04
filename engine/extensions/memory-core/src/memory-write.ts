// Adapted from lobehub/lobehub@4bcb808c608ed79497713ab20bcd03ac6d8713da
// packages/builtin-tool-memory/src/manifest.ts (add / update / remove memory APIs).
// Branch keeps memories as Markdown entries, so the add/update/remove operations
// edit entry lines in MEMORY.md, USER.md or memory/*.md through the same locked,
// hash-checked write path rings promotion uses.
import path from "node:path";
import { findEquivalentMemoryEntry, listMemoryEntryLines, normalizeFactTextKey } from "./fact-write-dedupe.js";
import { withMemoryWorkspaceLock } from "./memory-workspace-lock.js";
import { makeWorkspaceDirectory } from "./memory-workspace-files.js";
import {
  commitMemoryContent,
  hashMemoryContent,
  readMemoryContent,
  resolveMemoryWritePath,
} from "./short-term-promotion-memory-write.js";

export const MEMORY_WRITE_ACTIONS = ["add", "update", "remove"] as const;
export type MemoryWriteAction = (typeof MEMORY_WRITE_ACTIONS)[number];

export type MemoryWriteOperation = {
  action: MemoryWriteAction;
  /** Workspace-relative memory file; defaults to MEMORY.md. */
  path: string;
  /** New entry text for add/update. */
  content?: string;
  /** Existing entry text to update or remove. */
  match?: string;
  /** Markdown section heading that receives an added entry. */
  section?: string;
  /** Why an entry is removed (required by the upstream remove API). */
  reason?: string;
};

type MemoryWriteOutcome =
  | { status: "added" | "updated" | "removed"; entry: string; previous?: string }
  | { status: "duplicate"; existing: string }
  | { status: "not_found"; match: string }
  | { status: "ambiguous"; match: string; candidates: string[] };

export type MemoryWritePlan =
  | (Extract<MemoryWriteOutcome, { entry: string }> & { nextContent: string })
  | Exclude<MemoryWriteOutcome, { entry: string }>;

export type MemoryWriteResult = MemoryWriteOutcome & { path: string };

export const DEFAULT_MEMORY_WRITE_PATH = "MEMORY.md";

/** Resolve a workspace-relative memory path; only MEMORY.md, USER.md and memory/**.md are writable. */
export function normalizeMemoryWritePath(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_MEMORY_WRITE_PATH).trim().replaceAll("\\", "/") || DEFAULT_MEMORY_WRITE_PATH;
  if (path.posix.isAbsolute(value) || /^[a-zA-Z]:/u.test(value)) {
    throw new Error("path must be relative to the memory workspace");
  }
  const normalized = path.posix.normalize(value);
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("path must stay inside the memory workspace");
  }
  if (normalized === "MEMORY.md" || normalized === "USER.md") {
    return normalized;
  }
  if (normalized.startsWith("memory/") && normalized.toLowerCase().endsWith(".md")) {
    return normalized;
  }
  throw new Error("path must be MEMORY.md, USER.md or a Markdown file under memory/");
}

/** Entries are line-based; collapse newlines so one write stays one entry. */
export function normalizeEntryText(value: string | undefined, field: string): string {
  const text = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) {
    throw new Error(`${field} is required`);
  }
  return text;
}

function findMatchingEntries(content: string, match: string) {
  const key = normalizeFactTextKey(match);
  const entries = listMemoryEntryLines(content);
  const exact = entries.filter((entry) => key && normalizeFactTextKey(entry.text) === key);
  if (exact.length > 0) {
    return exact;
  }
  return entries.filter((entry) => entry.text.includes(match));
}

function insertEntry(content: string, entry: string, section: string | undefined): string {
  const line = `- ${entry}`;
  const lines = content.length > 0 ? content.replace(/\n+$/u, "").split("\n") : [];
  const heading = section?.replace(/^#+\s*/u, "").trim();
  if (!heading) {
    return `${[...lines, line].join("\n")}\n`;
  }
  const headingIndex = lines.findIndex(
    (candidate) => /^#{1,6}\s/u.test(candidate) && candidate.replace(/^#+\s*/u, "").trim().toLowerCase() === heading.toLowerCase(),
  );
  if (headingIndex < 0) {
    const spacer = lines.length > 0 ? [""] : [];
    return `${[...lines, ...spacer, `## ${heading}`, "", line].join("\n")}\n`;
  }
  let insertAt = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s/u.test(lines[index] ?? "")) {
      insertAt = index;
      break;
    }
  }
  while (insertAt > headingIndex + 1 && !(lines[insertAt - 1] ?? "").trim()) {
    insertAt -= 1;
  }
  const next = [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)];
  return `${next.join("\n")}\n`;
}

/** Pure planning step: what the file would look like after the operation. */
export function planMemoryWrite(content: string, op: MemoryWriteOperation): MemoryWritePlan {
  if (op.action === "add") {
    const entry = normalizeEntryText(op.content, "content");
    const existing = findEquivalentMemoryEntry(content, entry);
    if (existing) {
      return { status: "duplicate", existing: existing.text };
    }
    return { status: "added", nextContent: insertEntry(content, entry, op.section), entry };
  }
  const match = normalizeEntryText(op.match, "match");
  if (op.action === "remove") {
    normalizeEntryText(op.reason, "reason");
  }
  const entry = op.action === "update" ? normalizeEntryText(op.content, "content") : "";
  const matches = findMatchingEntries(content, match);
  if (matches.length === 0) {
    return { status: "not_found", match };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", match, candidates: matches.map((candidate) => candidate.text) };
  }
  const target = matches[0]!;
  const lines = content.split("\n");
  if (op.action === "update") {
    lines[target.index] = `${target.prefix}${entry}`;
    return { status: "updated", nextContent: lines.join("\n"), entry, previous: target.text };
  }
  lines.splice(target.index, 1);
  return { status: "removed", nextContent: lines.join("\n"), entry: target.text };
}

/** Apply one operation under the memory workspace lock with a hash-checked commit. */
export async function applyMemoryWrite(
  workspaceDir: string,
  op: MemoryWriteOperation,
): Promise<MemoryWriteResult> {
  const relativePath = normalizeMemoryWritePath(op.path);
  return await withMemoryWorkspaceLock(workspaceDir, async () => {
    const filePath = path.join(workspaceDir, ...relativePath.split("/"));
    await makeWorkspaceDirectory(workspaceDir, path.dirname(filePath));
    const writePath = await resolveMemoryWritePath(filePath, workspaceDir);
    const before = await readMemoryContent(writePath, workspaceDir);
    const plan = planMemoryWrite(before, { ...op, path: relativePath });
    if (!("nextContent" in plan)) {
      return { ...plan, path: relativePath };
    }
    await commitMemoryContent({
      workspaceDir,
      filePath: writePath,
      tempPrefix: `${path.basename(relativePath)}.memory-write`,
      expectedHash: hashMemoryContent(before),
      expectedContent: before,
      allowInPlaceFallback: true,
      conflictMessage: `${relativePath} changed before the memory write could commit`,
      content: plan.nextContent,
    });
    const { nextContent: _nextContent, ...result } = plan;
    return { ...result, path: relativePath };
  });
}
