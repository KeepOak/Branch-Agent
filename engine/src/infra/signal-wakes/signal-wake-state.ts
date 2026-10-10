import path from "node:path";
import { z } from "zod";
import { readJsonIfExists, writeJson } from "../json-files.js";
import type { PrSignalState } from "./signal-wake-decide.js";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";
const BACKUP_FILE = "state.json.bak";

const prStateSchema = z.object({
  redSha: z.string().optional(),
  fixCommentId: z.number().int().optional(),
});
const stateFileSchema = z.object({
  version: z.literal(STATE_VERSION),
  // repo key ("owner/name") -> PR number -> state
  repos: z.record(z.string(), z.record(z.string(), prStateSchema)),
});

/** Persisted dedupe state: repo key -> PR number -> state. */
export type SignalStateMap = Map<string, Map<number, PrSignalState>>;

/**
 * What a read produced. `recordOnly` means the file was unreadable and no backup was usable:
 * the first tick records state without waking, and `warning` says why.
 */
export type SignalStateLoad = { states: SignalStateMap; recordOnly: boolean; warning?: string };

export type SignalStateStore = {
  read(): Promise<SignalStateLoad>;
  write(states: SignalStateMap): Promise<void>;
};

export function signalWakeStatePath(stateDir: string): string {
  return path.join(stateDir, "signal-wakes", STATE_FILE);
}

function toFile(states: SignalStateMap) {
  const repos: Record<string, Record<string, PrSignalState>> = {};
  for (const [repo, prs] of states) {
    repos[repo] = Object.fromEntries([...prs].map(([number, state]) => [String(number), state]));
  }
  return { version: STATE_VERSION, repos } as const;
}

function fromParsed(data: z.infer<typeof stateFileSchema>): SignalStateMap {
  const states: SignalStateMap = new Map();
  for (const [repo, prs] of Object.entries(data.repos)) {
    const byNumber = new Map<number, PrSignalState>();
    for (const [number, state] of Object.entries(prs)) {
      byNumber.set(Number(number), state);
    }
    states.set(repo, byNumber);
  }
  return states;
}

type FileRead =
  | { status: "missing" }
  | { status: "ok"; raw: unknown; states: SignalStateMap }
  | { status: "bad"; reason: string };

async function readStateFile(filePath: string): Promise<FileRead> {
  try {
    const raw = await readJsonIfExists<unknown>(filePath);
    if (raw === null) {
      return { status: "missing" };
    }
    const parsed = stateFileSchema.safeParse(raw);
    return parsed.success
      ? { status: "ok", raw, states: fromParsed(parsed.data) }
      : { status: "bad", reason: "unexpected shape" };
  } catch (error) {
    return { status: "bad", reason: error instanceof Error ? error.message : "unreadable" };
  }
}

/**
 * JSON in the gateway state directory, written atomically. Before each write the previous valid
 * file is copied to `state.json.bak`. A corrupt file falls back to that backup, and with no usable
 * backup the load is record-only, so a corrupt file never silently resets to empty state.
 */
export function createFileSignalStateStore(filePath: string): SignalStateStore {
  const backupPath = path.join(path.dirname(filePath), BACKUP_FILE);
  return {
    async read() {
      const primary = await readStateFile(filePath);
      if (primary.status !== "bad") {
        return { states: primary.status === "ok" ? primary.states : new Map(), recordOnly: false };
      }
      const backup = await readStateFile(backupPath);
      if (backup.status === "ok") {
        return {
          states: backup.states,
          recordOnly: false,
          warning: `signal wake state is unreadable (${primary.reason}); restored the last good backup`,
        };
      }
      return {
        states: new Map(),
        recordOnly: true,
        warning: `signal wake state and its backup are unreadable (${primary.reason}); the first tick records state without waking`,
      };
    },
    async write(states) {
      const previous = await readStateFile(filePath);
      if (previous.status === "ok") {
        await writeJson(backupPath, previous.raw);
      }
      await writeJson(filePath, toFile(states));
    },
  };
}

/** In-process store for tests and for callers that do not need persistence. */
export function createMemorySignalStateStore(initial?: SignalStateMap): SignalStateStore {
  let current: SignalStateMap = initial ?? new Map();
  return {
    async read() {
      return { states: structuredClone(current), recordOnly: false };
    },
    async write(states) {
      current = structuredClone(states);
    },
  };
}
