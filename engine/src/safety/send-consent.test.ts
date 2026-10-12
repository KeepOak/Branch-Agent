// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/messaging/triage/actions/send-consent.persistence.test.ts (atlas SAFETY-0166)
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  assertDraftConsentDigest,
  createSendConsentStore,
  draftConsentDigest,
  requireSendConsent,
  type SendConsentDraft,
  type SendConsentTurn,
} from "./send-consent.js";

function withConsentStateDir(prefix: string, run: (stateDir: string) => Promise<void>) {
  return withTestDir({ prefix }, async (stateDir) => {
    try {
      await run(stateDir);
    } finally {
      await closeBranchStateDatabaseAsync();
    }
  });
}

it("binds actual draft sending to a later user turn and consumes consent once durably", async () => {
  await withConsentStateDir("message-consent-", async (stateDir) => {
    const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
    const agentId = randomUUID();
    const actor = randomUUID(),
      room = randomUUID();
    let timestamp = Date.now() - 10000;
    const turn = (text: string): SendConsentTurn => ({
      id: randomUUID(),
      entityId: actor,
      roomId: room,
      createdAt: ++timestamp,
      text,
    });
    const draft: SendConsentDraft = {
      draftId: randomUUID(),
      source: "telegram",
      to: [{ identifier: "actual-id", displayName: "Alice" }],
      body: "Original body",
    };
    const digestOfDraft = draftConsentDigest(draft);
    const store = createSendConsentStore({ env });

    const first = turn("Send this");
    expect(await requireSendConsent(store, agentId, first, digestOfDraft)).toBe("pending");
    expect(await requireSendConsent(store, agentId, first, digestOfDraft)).toBe("pending");

    // A second process opening the same database sees the armed consent.
    const reopened = createSendConsentStore({ env });
    const yes = turn("yes");
    const outcomes = await Promise.all([
      requireSendConsent(store, agentId, yes, digestOfDraft),
      requireSendConsent(reopened, agentId, yes, digestOfDraft),
    ]);
    expect(outcomes.filter((outcome) => outcome === "confirmed")).toHaveLength(1);
    expect(await requireSendConsent(store, agentId, yes, digestOfDraft)).toBe("cancelled");

    for (const text of [
      "yes, but change the recipient",
      "yes?",
      "do not send",
      "yes, don't send yet",
    ]) {
      const digest = randomUUID();
      expect(await requireSendConsent(store, agentId, turn("preview"), digest)).toBe("pending");
      expect(await requireSendConsent(store, agentId, turn(text), digest)).toBe("cancelled");
    }
    const chip = { affirmations: ["inbox approve entry-1"] };
    const chipDigest = randomUUID();
    await requireSendConsent(store, agentId, turn("preview"), chipDigest, chip);
    expect(
      await requireSendConsent(store, agentId, turn("Inbox approve entry-1"), chipDigest, chip),
    ).toBe("confirmed");
    const otherChipDigest = randomUUID();
    await requireSendConsent(store, agentId, turn("preview"), otherChipDigest, chip);
    expect(
      await requireSendConsent(
        store,
        agentId,
        turn("inbox approve entry-2"),
        otherChipDigest,
        chip,
      ),
    ).toBe("cancelled");
    const digest = randomUUID();
    await requireSendConsent(store, agentId, turn("preview"), digest);
    expect(
      await requireSendConsent(store, agentId, { ...turn("yes"), roomId: randomUUID() }, digest),
    ).toBe("pending");
    expect(
      await requireSendConsent(store, agentId, { ...turn("yes"), entityId: randomUUID() }, digest),
    ).toBe("pending");
    expect(await requireSendConsent(store, agentId, turn("yes"), "changed-body")).toBe("pending");
    const staleDigest = draftConsentDigest(draft);
    expect(() => assertDraftConsentDigest({ ...draft, body: "Changed body" }, staleDigest)).toThrow(
      expect.objectContaining({ code: "MESSAGE_DRAFT_CONSENT_DIGEST_MISMATCH" }),
    );
    expect(() => assertDraftConsentDigest(draft, staleDigest)).not.toThrow();
  });
});

it("refuses consent from the agent itself or from an unidentified turn", async () => {
  await withConsentStateDir("message-consent-identity-", async (stateDir) => {
    const store = createSendConsentStore({ env: { ...process.env, BRANCH_STATE_DIR: stateDir } });
    const agentId = randomUUID();
    const base = { id: randomUUID(), roomId: randomUUID(), createdAt: Date.now(), text: "yes" };
    await expect(
      requireSendConsent(store, agentId, { ...base, entityId: agentId }, "digest"),
    ).rejects.toMatchObject({ code: "MESSAGE_CONFIRMATION_TURN_REQUIRED" });
    await expect(requireSendConsent(store, agentId, { ...base }, "digest")).rejects.toMatchObject({
      code: "MESSAGE_CONFIRMATION_TURN_REQUIRED",
    });
  });
});
