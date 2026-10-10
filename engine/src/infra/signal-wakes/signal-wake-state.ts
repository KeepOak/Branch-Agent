import path from "node:path";
import { z } from "zod";
import { readJsonIfExists, writeJson } from "../json-files.js";
import type { PrSignalState } from "./signal-wake-decide.js";

const STATE_VERSION = 1;
const STATE_FILE = "state.json";

const prStateSchema = z.object({
  redSha: z.string().optional(),
  fixCommentId: z.number().int().optional(),
});
const stateFileSchema = z.object({
  version: z.literal(STATE_VERSION),
  // repo key ("owner/name") -> PR number -> state
  repos: z.record(z.string(), z.record(z.string(), prStateSchema)),
});

/** Persisted dedupe state: repo key -> PR number -> state. Read at start, written after each tick. */
export type SignalStateMap = Map<string, Map<number, PrSignalState>>;

export type SignalStateStore = {
  read(): Promise<SignalStateMap>;
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

function fromFile(value: unknown): SignalStateMap {
  const parsed = stateFileSchema.safeParse(value);
  const states: SignalStateMap = new Map();
  if (!parsed.success) {
    return states;
  }
  for (const [repo, prs] of Object.entries(parsed.data.repos)) {
    const byNumber = new Map<number, PrSignalState>();
    for (const [number, state] of Object.entries(prs)) {
      byNumber.set(Number(number), state);
    }
    states.set(repo, byNumber);
  }
  return states;
}

/** A JSON file in the gateway state directory, written atomically. Missing or invalid files read as empty. */
export function createFileSignalStateStore(filePath: string): SignalStateStore {
  return {
    async read() {
      return fromFile(await readJsonIfExists<unknown>(filePath));
    },
    async write(states) {
      await writeJson(filePath, toFile(states));
    },
  };
}

/** In-process store for tests and for callers that do not need persistence. */
export function createMemorySignalStateStore(initial?: SignalStateMap): SignalStateStore {
  let current: SignalStateMap = initial ?? new Map();
  return {
    async read() {
      return structuredClone(current);
    },
    async write(states) {
      current = structuredClone(states);
    },
  };
}
