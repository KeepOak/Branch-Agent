import { randomUUID } from "node:crypto";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { loadSessionEntry, upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import { appendAssistantMessageToSessionTranscript } from "../config/sessions/transcript.js";
import type { BranchConfig } from "../config/types.branch.js";

/** The first line a new Trunk says. Static on purpose: no model turn, no tokens, one question. */
export const FIRST_RUN_GREETING_TEXT =
  "Hey, I'm your new Trunk and I just came online. How are you doing?";

export type FirstRunGreetingCreateResult = {
  status: "created" | "existing";
  bootstrapPending: boolean;
};

export type FirstRunGreetingOutcome = "seeded" | "failed";

/** Only a brand-new Trunk that still has its first-run ritual pending greets the owner. */
export function shouldSeedFirstRunGreeting(result: FirstRunGreetingCreateResult): boolean {
  return result.status === "created" && result.bootstrapPending;
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
  const result = await appendAssistantMessageToSessionTranscript({
    agentId: params.agentId,
    sessionKey,
    storePath: params.storePath,
    text: FIRST_RUN_GREETING_TEXT,
    idempotencyKey: `first-run-greeting:${params.agentId}`,
    config: params.cfg,
  });
  return result.ok ? "seeded" : "failed";
}
