import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope-config.js";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { loadSessionEntry, upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import { appendAssistantMessageToSessionTranscript } from "../config/sessions/transcript.js";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";

/** The first line a new Trunk says. Static on purpose: no model turn, no tokens, one question. */
export const FIRST_RUN_GREETING_TEXT =
  "Hey, I'm your new Trunk and I just came online. How are you doing?";

/** Directive the first-run ritual saves to the owner profile (USER.md) once it learns the name. */
const OWNER_NAME_DIRECTIVE = /address the owner as ([^.\n]{1,40})\./i;
const PLAUSIBLE_NAME = /^[\p{L}][\p{L} .'-]{0,39}$/u;
const MAX_PROFILE_BYTES = 64 * 1024;

export type FirstRunGreetingCreateResult = {
  agentId: string;
  status: "created" | "existing";
  bootstrapPending: boolean;
};

export type FirstRunGreetingOutcome = "seeded" | "failed";

/** Only a brand-new Trunk that still has its first-run ritual pending greets the owner. */
export function shouldSeedFirstRunGreeting(result: FirstRunGreetingCreateResult): boolean {
  return result.status === "created" && result.bootstrapPending;
}

/** The greeting, using the owner's name when the shared profile already has it. */
export function firstRunGreetingText(ownerName?: string): string {
  const name = ownerName?.trim();
  if (!name || !PLAUSIBLE_NAME.test(name)) {
    return FIRST_RUN_GREETING_TEXT;
  }
  return `Hey ${name}, I just came online. How are you doing?`;
}

/**
 * Reads the owner's name from the shared owner profile (USER.md) in a workspace. Each observed block
 * is one entry; a superseded block is ignored, and the last active directive wins.
 */
export async function readOwnerNameFromProfile(workspaceDir: string): Promise<string | undefined> {
  try {
    const file = path.join(workspaceDir, "USER.md");
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) {
      return undefined;
    }
    const blocks = (await fs.readFile(file, "utf8")).split(/<!--\s*observed:/i);
    let name: string | undefined;
    for (const block of blocks) {
      if (/status:\s*superseded/i.test(block.split("\n")[0] ?? "")) {
        continue;
      }
      name = OWNER_NAME_DIRECTIVE.exec(block)?.[1]?.trim() ?? name;
    }
    return name;
  } catch {
    return undefined;
  }
}

/** Resolves the owner profile workspace; a config that cannot resolve one just means no name. */
function defaultOwnerWorkspaceDir(cfg: BranchConfig): string | undefined {
  try {
    return resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  } catch {
    return undefined;
  }
}

/**
 * Writes the greeting once into the Trunk's main session. The idempotency key makes retries and
 * restarts no-ops, so the greeting is an event on creation, never a timer.
 */
export async function seedFirstRunGreeting(params: {
  cfg: BranchConfig;
  agentId: string;
  /** Explicit store path, for tests and tooling. Production resolves it from cfg. */
  storePath?: string;
  /** Owner profile workspace, for tests. Production reads the default Trunk's workspace. */
  ownerWorkspaceDir?: string;
}): Promise<FirstRunGreetingOutcome> {
  const ownerDir = params.ownerWorkspaceDir ?? defaultOwnerWorkspaceDir(params.cfg);
  const ownerName = ownerDir ? await readOwnerNameFromProfile(ownerDir) : undefined;
  const sessionKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId: params.agentId });
  const scope = { agentId: params.agentId, sessionKey, storePath: params.storePath };
  if (!loadSessionEntry(scope)?.sessionId) {
    await upsertSessionEntryCore(scope, {
      sessionId: randomUUID(),
      updatedAt: Date.now(),
      chatType: "direct",
    });
  }
  const result = await appendAssistantMessageToSessionTranscript({
    agentId: params.agentId,
    sessionKey,
    storePath: params.storePath,
    text: firstRunGreetingText(ownerName),
    idempotencyKey: `first-run-greeting:${params.agentId}`,
    config: params.cfg,
  });
  return result.ok ? "seeded" : "failed";
}

/**
 * Called from agents.create right after a successful create. Scheduled, never awaited: the create
 * response does not wait on the greeting, and nothing thrown here reaches the caller.
 */
/** Greetings still being written. Tests await them with settleFirstRunGreetings(), never with timers. */
const pendingGreetings = new Set<Promise<void>>();

/**
 * Called from agents.create right after a successful create. Scheduled, never awaited: the create response does not
 * wait on the greeting, and nothing thrown here reaches the caller.
 */
export function scheduleFirstRunGreeting(params: {
  result: FirstRunGreetingCreateResult;
  getConfig: () => BranchConfig;
  warn: (message: string) => void;
  seed?: typeof seedFirstRunGreeting;
}): void {
  if (!shouldSeedFirstRunGreeting(params.result)) {
    return;
  }
  const { agentId } = params.result;
  const seed = params.seed ?? seedFirstRunGreeting;
  const greeting = (async () => {
    try {
      const outcome = await seed({ cfg: params.getConfig(), agentId });
      if (outcome === "failed") {
        params.warn(`agent ${agentId} first-run greeting was not saved`);
      }
    } catch (error) {
      params.warn(`agent ${agentId} first-run greeting failed: ${formatErrorMessage(error)}`);
    }
  })();
  pendingGreetings.add(greeting);
  void greeting.finally(() => {
    pendingGreetings.delete(greeting);
  });
}

/** Resolves once every greeting scheduled so far has finished, win or fail. For tests only. */
export async function settleFirstRunGreetings(): Promise<void> {
  while (pendingGreetings.size > 0) {
    await Promise.all(pendingGreetings);
  }
}
