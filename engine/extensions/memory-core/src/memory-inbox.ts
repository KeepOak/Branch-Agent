// Adapted from google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad
// packages/core/src/services/memoryPatchUtils.ts (inbox listing, path normalization, validation).
// Memory review inbox: when review is required, proposed memory changes wait
// as files in the agent's inbox; the owner accepts (applies) or rejects each.
// Proposals keep the full operation, so an accepted one applies exactly what
// was proposed, and they survive restarts because they live on disk.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "branch/plugin-sdk/memory-core-host-engine-foundation";
import {
  applyMemoryWrite,
  MEMORY_WRITE_ACTIONS,
  normalizeMemoryWritePath,
  planMemoryWrite,
  type MemoryWriteOperation,
  type MemoryWriteResult,
} from "./memory-write.js";
import { readMemoryContent } from "./short-term-promotion-memory-write.js";

const PROPOSAL_EXTENSION = ".json";

export type MemoryProposal = {
  version: 1;
  id: string;
  agentId: string;
  createdAt: string;
  source: string;
  operation: MemoryWriteOperation;
  /** Line-level diff preview: removed lines start with "-", added lines with "+". */
  diff: string;
};

export type MemoryInboxEntry = MemoryProposal & { file: string };

export function getMemoryInboxRoot(agentId: string): string {
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(resolveStateDir(), "memory-core", "inbox", safeAgentId);
}

/** Inbox-relative proposal path, or undefined when it could escape the inbox. */
export function normalizeInboxProposalPath(relativePath: string): string | undefined {
  if (relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    return undefined;
  }
  const normalizedPath = path.posix.normalize(relativePath);
  if (
    normalizedPath === "." ||
    normalizedPath.startsWith("../") ||
    normalizedPath === ".." ||
    !normalizedPath.endsWith(PROPOSAL_EXTENSION)
  ) {
    return undefined;
  }
  return normalizedPath;
}

/**
 * Absolute paths of every proposal file in the agent's inbox, sorted for
 * stable ordering. A raw listing: it does not validate proposal shape.
 */
export async function listInboxProposalFiles(agentId: string): Promise<string[]> {
  const root = getMemoryInboxRoot(agentId);
  const found: string[] = [];
  async function walk(currentDir: string): Promise<void> {
    let dirEntries: Array<import("node:fs").Dirent>;
    try {
      dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(PROPOSAL_EXTENSION)) {
        found.push(entryPath);
      }
    }
  }
  await walk(root);
  return found.sort();
}

export type ValidateInboxProposalResult =
  | { valid: true; proposal: MemoryProposal }
  | { valid: false; reason: string };

/** Parseable proposal with a known action and a target inside the memory files. */
export async function validateInboxProposalFile(sourcePath: string): Promise<ValidateInboxProposalResult> {
  let content: string;
  try {
    content = await fs.readFile(sourcePath, "utf-8");
  } catch (error) {
    return {
      valid: false,
      reason: `failed to read proposal: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let parsed: Partial<MemoryProposal>;
  try {
    parsed = JSON.parse(content) as Partial<MemoryProposal>;
  } catch (error) {
    return {
      valid: false,
      reason: `failed to parse proposal: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const operation = parsed.operation;
  if (
    !parsed.id ||
    !operation ||
    !MEMORY_WRITE_ACTIONS.some((action) => action === operation.action)
  ) {
    return { valid: false, reason: "proposal has no memory operation" };
  }
  try {
    normalizeMemoryWritePath(operation.path);
  } catch {
    return { valid: false, reason: `target file is outside memory files: ${operation.path}` };
  }
  return { valid: true, proposal: parsed as MemoryProposal };
}

/** Only the proposals that pass validation: what the owner actually sees. */
export async function listMemoryInbox(agentId: string): Promise<MemoryInboxEntry[]> {
  const entries: MemoryInboxEntry[] = [];
  for (const file of await listInboxProposalFiles(agentId)) {
    const validation = await validateInboxProposalFile(file);
    if (validation.valid) {
      entries.push({ ...validation.proposal, file });
    }
  }
  return entries;
}

function buildDiff(op: MemoryWriteOperation, previous: string | undefined, entry: string): string {
  const header = `--- ${op.path}\n+++ ${op.path}`;
  if (op.action === "add") {
    return `${header}\n+ ${entry}`;
  }
  if (op.action === "remove") {
    return `${header}\n- ${entry}`;
  }
  return `${header}\n- ${previous ?? ""}\n+ ${entry}`;
}

export type StageMemoryProposalResult =
  | { status: "pending_review"; id: string; path: string; diff: string }
  | Exclude<MemoryWriteResult, { status: "added" | "updated" | "removed" }>;

/** Plan the operation against the current file and park it in the inbox. */
export async function stageMemoryProposal(params: {
  agentId: string;
  workspaceDir: string;
  operation: MemoryWriteOperation;
  source: string;
}): Promise<StageMemoryProposalResult> {
  const relativePath = normalizeMemoryWritePath(params.operation.path);
  const operation = { ...params.operation, path: relativePath };
  const filePath = path.join(params.workspaceDir, ...relativePath.split("/"));
  const current = await readMemoryContent(filePath, params.workspaceDir);
  const plan = planMemoryWrite(current, operation);
  if (!("nextContent" in plan)) {
    return { ...plan, path: relativePath };
  }
  const id = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const proposal: MemoryProposal = {
    version: 1,
    id,
    agentId: params.agentId,
    createdAt: new Date().toISOString(),
    source: params.source,
    operation,
    diff: buildDiff(operation, plan.previous, plan.entry),
  };
  const root = getMemoryInboxRoot(params.agentId);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const target = path.join(root, `${id}${PROPOSAL_EXTENSION}`);
  const temp = `${target}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(temp, JSON.stringify(proposal, null, 2), { encoding: "utf-8", mode: 0o600 });
  await fs.rename(temp, target);
  return { status: "pending_review", id, path: relativePath, diff: proposal.diff };
}

async function findProposal(agentId: string, id: string): Promise<MemoryInboxEntry> {
  const normalized = normalizeInboxProposalPath(`${id}${PROPOSAL_EXTENSION}`);
  const entry = normalized
    ? (await listMemoryInbox(agentId)).find((candidate) => candidate.id === id)
    : undefined;
  if (!entry) {
    throw new Error(`No pending memory proposal with id "${id}".`);
  }
  return entry;
}

/** Apply an accepted proposal exactly as proposed, then remove it from the inbox. */
export async function acceptMemoryProposal(params: {
  agentId: string;
  workspaceDir: string;
  id: string;
}): Promise<MemoryWriteResult> {
  const entry = await findProposal(params.agentId, params.id);
  const result = await applyMemoryWrite(params.workspaceDir, entry.operation);
  await fs.rm(entry.file, { force: true });
  return result;
}

export async function rejectMemoryProposal(params: { agentId: string; id: string }): Promise<{
  rejected: true;
  id: string;
}> {
  const entry = await findProposal(params.agentId, params.id);
  await fs.rm(entry.file, { force: true });
  return { rejected: true, id: params.id };
}
