import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { TeamDraftRole } from "./trunk-team.js";

/**
 * One record per proposal, by its hash. A proposal is pending while its approval waits, declined when the owner says
 * no (and never reopened), and applying, applied, or failed once it is allowed.
 */
export type ProposalState = "pending" | "expired" | "declined" | "applying" | "applied" | "failed";

export type ProposalRecord = {
  hash: string;
  teamId: string;
  goal: string;
  roles?: TeamDraftRole[];
  state: ProposalState;
  /** The approval record the Inbox shows. Cleared when the open did not register. */
  approvalId?: string;
  created?: string[];
  message?: string;
  updatedAt: number;
};

type Store = Record<string, ProposalRecord>;

function file(env?: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env), "trunks", "team-proposals.json");
}

function read(env?: NodeJS.ProcessEnv): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(env), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store, env?: NodeJS.ProcessEnv): void {
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

export function readProposal(hash: string, env?: NodeJS.ProcessEnv): ProposalRecord | undefined {
  return read(env)[hash];
}

/** Saves a proposal's state. The record is replaced whole, so a state change never leaves stale fields behind. */
export function saveProposal(
  record: Omit<ProposalRecord, "updatedAt"> & { updatedAt?: number },
  env?: NodeJS.ProcessEnv,
): ProposalRecord {
  const store = read(env);
  const saved: ProposalRecord = { ...record, updatedAt: record.updatedAt ?? Date.now() };
  store[record.hash] = saved;
  write(store, env);
  return saved;
}

/** Removes a proposal's record, for an open that never registered an approval. */
export function forgetProposal(hash: string, env?: NodeJS.ProcessEnv): void {
  const store = read(env);
  if (store[hash] === undefined) {
    return;
  }
  delete store[hash];
  write(store, env);
}
