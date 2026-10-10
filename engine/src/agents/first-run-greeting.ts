import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { loadSessionEntry, upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import { appendAssistantMessageToSessionTranscript } from "../config/sessions/transcript.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "./agent-scope-config.js";

/** The first line a new Trunk says. Static on purpose: no model turn, no tokens, one question. */
export const FIRST_RUN_GREETING_TEXT =
  "Hey, I'm your new Trunk and I just came online. How are you doing?";

/** Directive the first-run ritual saves to the owner profile (USER.md) once it learns the name. */
const OWNER_NAME_DIRECTIVE = /address the owner as ([^.\n]{1,40})\./i;
const PLAUSIBLE_NAME = /^[\p{L}][\p{L} .'-]{0,39}$/u;
const MAX_PROFILE_BYTES = 64 * 1024;

export type FirstRunGreetingCreateResult = {
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

/** Reads the owner's name from the shared owner profile (USER.md) in a workspace, if it is there. */
export async function readOwnerNameFromProfile(workspaceDir: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(path.join(workspaceDir, "USER.md"));
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) {
      return undefined;
    }
    const text = await fs.readFile(path.join(workspaceDir, "USER.md"), "utf8");
    return OWNER_NAME_DIRECTIVE.exec(text)?.[1]?.trim();
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
  const sessionKey = resolveAgentMainSessionKey({ cfg: params.cfg, agentId: params.agentId });
  const scope = { agentId: params.agentId, sessionKey, storePath: params.storePath };
  if (!loadSessionEntry(scope)?.sessionId) {
    await upsertSessionEntryCore(scope, {
      sessionId: randomUUID(),
      updatedAt: Date.now(),
      chatType: "direct",
    });
  }
  const ownerDir =
    params.ownerWorkspaceDir ??
    resolveAgentWorkspaceDir(params.cfg, resolveDefaultAgentId(params.cfg));
  const ownerName = await readOwnerNameFromProfile(ownerDir);
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
