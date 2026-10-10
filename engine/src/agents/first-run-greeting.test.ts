import { describe, expect, it } from "vitest";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { loadSessionEntry, loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { useTempSessionsFixture } from "../config/sessions/test-helpers.js";
import {
  FIRST_RUN_GREETING_TEXT,
  seedFirstRunGreeting,
  shouldSeedFirstRunGreeting,
} from "./first-run-greeting.js";

const fixture = useTempSessionsFixture("first-run-greeting-test-");

async function assistantTexts(storePath: string, agentId: string, sessionKey: string) {
  const entry = loadSessionEntry({ agentId, sessionKey, storePath });
  const events = await loadTranscriptEvents({
    agentId,
    sessionId: entry?.sessionId ?? "",
    sessionKey,
    storePath,
  });
  return events.flatMap((event) => {
    const message = (event as { message?: { role?: string; content?: unknown } }).message;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      return [];
    }
    return message.content.map((block) => (block as { text?: string }).text ?? "");
  });
}

describe("shouldSeedFirstRunGreeting", () => {
  it("greets only a brand-new Trunk whose first-run ritual is still pending", () => {
    expect(shouldSeedFirstRunGreeting({ status: "created", bootstrapPending: true })).toBe(true);
    expect(shouldSeedFirstRunGreeting({ status: "created", bootstrapPending: false })).toBe(false);
    expect(shouldSeedFirstRunGreeting({ status: "existing", bootstrapPending: true })).toBe(false);
    expect(shouldSeedFirstRunGreeting({ status: "existing", bootstrapPending: false })).toBe(false);
  });
});

describe("FIRST_RUN_GREETING_TEXT", () => {
  it("asks exactly one question, short, with no em dash", () => {
    expect(FIRST_RUN_GREETING_TEXT.split("?").length - 1).toBe(1);
    expect(FIRST_RUN_GREETING_TEXT.length).toBeLessThanOrEqual(120);
    expect(FIRST_RUN_GREETING_TEXT).not.toMatch(/—/);
  });
});

describe("seedFirstRunGreeting", () => {
  it("writes the greeting once into the Trunk's main session", async () => {
    const storePath = fixture.storePath();
    const cfg = {};
    const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "main" });

    const outcome = await seedFirstRunGreeting({ cfg, agentId: "main", storePath });

    expect(outcome).toBe("seeded");
    expect(await assistantTexts(storePath, "main", sessionKey)).toEqual([FIRST_RUN_GREETING_TEXT]);
  });

  it("does not repeat the greeting when it runs again", async () => {
    const storePath = fixture.storePath();
    const cfg = {};
    const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "main" });

    await seedFirstRunGreeting({ cfg, agentId: "main", storePath });
    await seedFirstRunGreeting({ cfg, agentId: "main", storePath });

    expect(await assistantTexts(storePath, "main", sessionKey)).toHaveLength(1);
  });
});
