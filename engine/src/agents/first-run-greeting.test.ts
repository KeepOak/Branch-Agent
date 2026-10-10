import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { loadSessionEntry, loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { useTempSessionsFixture } from "../config/sessions/test-helpers.js";
import {
  FIRST_RUN_GREETING_TEXT,
  firstRunGreetingText,
  readOwnerNameFromProfile,
  seedFirstRunGreeting,
  shouldSeedFirstRunGreeting,
} from "./first-run-greeting.js";

function ownerWorkspace(userMd?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-run-owner-"));
  if (userMd !== undefined) {
    fs.writeFileSync(path.join(dir, "USER.md"), userMd);
  }
  return dir;
}

const NAMED_PROFILE =
  "# USER.md\n\n<!-- observed: 2026-10-10 | status: active -->\n\n- Always address the owner as Taofik.\n";

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

    const outcome = await seedFirstRunGreeting({
      cfg,
      agentId: "main",
      storePath,
      ownerWorkspaceDir: ownerWorkspace(),
    });

    expect(outcome).toBe("seeded");
    expect(await assistantTexts(storePath, "main", sessionKey)).toEqual([FIRST_RUN_GREETING_TEXT]);
  });

  it("does not repeat the greeting when it runs again", async () => {
    const storePath = fixture.storePath();
    const cfg = {};
    const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "main" });

    const ownerWorkspaceDir = ownerWorkspace();
    await seedFirstRunGreeting({ cfg, agentId: "main", storePath, ownerWorkspaceDir });
    await seedFirstRunGreeting({ cfg, agentId: "main", storePath, ownerWorkspaceDir });

    expect(await assistantTexts(storePath, "main", sessionKey)).toHaveLength(1);
  });
});

describe("owner name in the greeting", () => {
  it("reads the name the ritual saved to the owner profile", async () => {
    expect(await readOwnerNameFromProfile(ownerWorkspace(NAMED_PROFILE))).toBe("Taofik");
  });

  it("uses the owner's name when the shared profile has it", async () => {
    const storePath = fixture.storePath();
    const cfg = {};
    const sessionKey = resolveAgentMainSessionKey({ cfg, agentId: "main" });

    await seedFirstRunGreeting({
      cfg,
      agentId: "main",
      storePath,
      ownerWorkspaceDir: ownerWorkspace(NAMED_PROFILE),
    });

    expect(await assistantTexts(storePath, "main", sessionKey)).toEqual([
      "Hey Taofik, I just came online. How are you doing?",
    ]);
  });

  it("falls back to the plain greeting without a profile or with an unsafe name", async () => {
    expect(firstRunGreetingText()).toBe(FIRST_RUN_GREETING_TEXT);
    expect(firstRunGreetingText("<b>Taofik</b>")).toBe(FIRST_RUN_GREETING_TEXT);
    expect(await readOwnerNameFromProfile(ownerWorkspace())).toBeUndefined();
  });
});
