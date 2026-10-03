import { describe, expect, it } from "vitest";
import {
  closeBranchAgentDatabaseByPathAsync,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import {
  appendTranscriptMessage,
  loadTranscriptEvents,
  replaceSessionEntry,
} from "./session-accessor.js";
import { readTranscriptEventMessage } from "./session-accessor.sqlite-read.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";
import { useTempSessionsFixture } from "./test-helpers.js";
import {
  appendAssistantMessageToSessionTranscript,
  appendExactAssistantMessageToSessionTranscript,
} from "./transcript.js";

// Literal v2026.9.4 representation: the current constructor must not seed legacy fixtures.
function legacyMirrorMessage(text = "Chart") {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "branch-transcript",
    provider: "branch",
    model: "delivery-mirror",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: 1_700_000_000_000,
  };
}

describe("assistant mirror media identity", () => {
  const fixture = useTempSessionsFixture("transcript-media-identity-");

  async function createScope() {
    const scope = {
      agentId: "main",
      sessionId: "legacy-media-session",
      sessionKey: "agent:main:legacy-media",
      storePath: fixture.storePath(),
    };
    await replaceSessionEntry(scope, { sessionId: scope.sessionId, updatedAt: 1 });
    return scope;
  }

  function database() {
    const target = resolveSqliteTargetFromSessionStorePath(fixture.storePath());
    return openBranchAgentDatabase({ agentId: "main", path: target.path });
  }

  // Read serialized payloads, not parsed projections: replay must preserve accepted bytes.
  function readRawEvents(sessionId: string) {
    return database()
      .db.prepare("SELECT event_json FROM transcript_events WHERE session_id = ? ORDER BY seq")
      .all(sessionId);
  }

  it.each([false, true])(
    "replays literal legacy media bytes before and after reopen with content=%s",
    async (explicitContent) => {
      const scope = await createScope();
      const original = legacyMirrorMessage(explicitContent ? "Chart" : "Chart\nchart.png");
      const params = {
        ...scope,
        expectedSessionId: scope.sessionId,
        idempotencyKey: "legacy-media-reply",
        text: "Chart",
        ...(explicitContent ? { content: [{ type: "text" as const, text: "Chart" }] } : {}),
        mediaUrls: ["https://example.com/chart.png"],
      };
      const first = await appendExactAssistantMessageToSessionTranscript({
        ...params,
        message: original,
      });
      expect(first.ok).toBe(true);
      const before = readRawEvents(scope.sessionId);
      expect(before.length).toBeGreaterThan(0);
      expect(await appendAssistantMessageToSessionTranscript(params)).toEqual(first);
      expect(readRawEvents(scope.sessionId)).toEqual(before);

      const owner = database();
      expect(await closeBranchAgentDatabaseByPathAsync(owner.path, scope.agentId)).toBe(true);
      expect(owner.db.isOpen).toBe(false);
      expect(await appendAssistantMessageToSessionTranscript(params)).toEqual(first);
      expect(database()).not.toBe(owner);
      expect(readRawEvents(scope.sessionId)).toEqual(before);
      const assistants = (await loadTranscriptEvents(scope))
        .map(readTranscriptEventMessage)
        .filter((message) => message?.role === "assistant");
      expect(assistants).toEqual([{ ...original, idempotencyKey: params.idempotencyKey }]);

      await expect(
        appendAssistantMessageToSessionTranscript({
          ...params,
          text: "Different",
          ...(explicitContent ? { content: [{ type: "text" as const, text: "Different" }] } : {}),
        }),
      ).rejects.toThrow("conflicts with the admitted message");
      expect(readRawEvents(scope.sessionId)).toEqual(before);

      // A legacy row cannot relax URL identity for new rows in the same database.
      const fresh = { ...params, idempotencyKey: "new-media-reply" };
      const admitted = await appendAssistantMessageToSessionTranscript(fresh);
      expect(admitted.ok).toBe(true);
      expect(await appendAssistantMessageToSessionTranscript(fresh)).toEqual(admitted);
      await expect(
        appendAssistantMessageToSessionTranscript({
          ...fresh,
          mediaUrls: ["https://different.example/chart.png"],
        }),
      ).rejects.toThrow("conflicts with the admitted message");
      await expect(
        appendAssistantMessageToSessionTranscript({ ...fresh, mediaUrls: undefined }),
      ).rejects.toThrow("conflicts with the admitted message");
    },
  );

  it("records empty media identity so new explicit content cannot acquire media on replay", async () => {
    const scope = await createScope();
    const params = {
      ...scope,
      expectedSessionId: scope.sessionId,
      idempotencyKey: "new-no-media-reply",
      content: [{ type: "text" as const, text: "Chart" }],
    };
    const first = await appendAssistantMessageToSessionTranscript(params);
    expect(first.ok).toBe(true);
    expect(await appendAssistantMessageToSessionTranscript(params)).toEqual(first);
    const before = readRawEvents(scope.sessionId);
    expect(
      (await loadTranscriptEvents(scope)).map(readTranscriptEventMessage).filter(Boolean),
    ).toEqual([expect.objectContaining({ branchDelivery: { mediaUrls: [] } })]);
    await expect(
      appendAssistantMessageToSessionTranscript({
        ...params,
        mediaUrls: ["https://example.com/chart.png"],
      }),
    ).rejects.toThrow("conflicts with the admitted message");
    expect(readRawEvents(scope.sessionId)).toEqual(before);
  });

  it("preserves legacy display and delivery facts and rejects changes to either", async () => {
    const scope = await createScope();
    const original = {
      ...legacyMirrorMessage(),
      idempotencyKey: "legacy-facts",
      branchDisplayContent: [{ type: "text", text: "Visible chart" }],
      branchDelivery: { audioAsVoice: true as const, replyToId: "source-message" },
      branchDeliveryMirror: { kind: "channel-final", sourceMessageId: "source-message" },
    };
    const first = await appendExactAssistantMessageToSessionTranscript({
      ...scope,
      message: original,
    });
    expect(first.ok).toBe(true);
    const before = readRawEvents(scope.sessionId);
    const candidate = {
      ...original,
      branchDelivery: {
        ...original.branchDelivery,
        mediaUrls: ["https://example.com/chart.png"],
      },
    };
    expect(
      await appendExactAssistantMessageToSessionTranscript({ ...scope, message: candidate }),
    ).toEqual(first);
    for (const message of [
      { ...candidate, branchDisplayContent: [{ type: "text", text: "Different" }] },
      { ...candidate, branchDelivery: { ...candidate.branchDelivery, replyToId: "other" } },
      {
        ...candidate,
        branchDelivery: {
          replyToId: "source-message",
          mediaUrls: candidate.branchDelivery.mediaUrls,
        },
      },
      { ...candidate, branchDeliveryMirror: { kind: "channel-final", sourceMessageId: "other" } },
      { ...candidate, usage: { ...candidate.usage, output: 1 } },
      { ...candidate, model: "gateway-injected" },
    ]) {
      await expect(
        appendExactAssistantMessageToSessionTranscript({ ...scope, message }),
      ).rejects.toThrow("conflicts with the admitted message");
    }
    expect(readRawEvents(scope.sessionId)).toEqual(before);
  });

  it.each([{ mediaUrls: [] }, { mediaUrls: null }, { mediaUrls: "invalid" }, { mediaUrls: [42] }])(
    "keeps a stored own mediaUrls field strict: $mediaUrls",
    async ({ mediaUrls }) => {
      const scope = await createScope();
      // Generic append can seed malformed facts without a type cast or raw SQL write.
      const original = {
        ...legacyMirrorMessage(),
        idempotencyKey: "present-media-identity",
        branchDelivery: { mediaUrls },
      };
      const first = await appendTranscriptMessage(scope, { message: original });
      expect(first.appended).toBe(true);
      expect(first.message.branchDelivery).toEqual({ mediaUrls });
      expect((await appendTranscriptMessage(scope, { message: original })).appended).toBe(false);
      const before = readRawEvents(scope.sessionId);
      await expect(
        appendAssistantMessageToSessionTranscript({
          ...scope,
          idempotencyKey: original.idempotencyKey,
          content: original.content,
          mediaUrls: ["https://example.com/chart.png"],
        }),
      ).rejects.toThrow("conflicts with the admitted message");
      await expect(
        appendExactAssistantMessageToSessionTranscript({
          ...scope,
          idempotencyKey: original.idempotencyKey,
          message: legacyMirrorMessage(),
        }),
      ).rejects.toThrow("conflicts with the admitted message");
      expect(readRawEvents(scope.sessionId)).toEqual(before);
    },
  );

  it.each([
    { role: "user", api: "branch-transcript", provider: "branch", model: "delivery-mirror" },
    {
      role: "assistant",
      api: "branch-transcript",
      provider: "branch",
      model: "gateway-injected",
    },
    { role: "assistant", api: "provider-api", provider: "branch", model: "delivery-mirror" },
    { role: "assistant", api: "branch-transcript", provider: "other", model: "delivery-mirror" },
  ])("does not relax media identity for $role/$api/$provider/$model", async (identity) => {
    const scope = await createScope();
    const original = { ...legacyMirrorMessage(), ...identity, idempotencyKey: "non-mirror" };
    const first = await appendTranscriptMessage(scope, { message: original });
    expect(first.appended).toBe(true);
    expect((await appendTranscriptMessage(scope, { message: original })).appended).toBe(false);
    const before = readRawEvents(scope.sessionId);
    await expect(
      appendTranscriptMessage(scope, {
        message: {
          ...original,
          branchDelivery: { mediaUrls: ["https://example.com/chart.png"] },
        },
      }),
    ).rejects.toThrow("conflicts with the admitted message");
    expect(readRawEvents(scope.sessionId)).toEqual(before);
  });

  it.each([false, true])("records media identity with content=%s", async (explicitContent) => {
    const scope = {
      agentId: "main",
      sessionId: "media-session",
      sessionKey: "agent:main:media",
      storePath: fixture.storePath(),
    };
    await replaceSessionEntry(scope, { sessionId: scope.sessionId, updatedAt: 1 });
    const params = {
      ...scope,
      expectedSessionId: scope.sessionId,
      idempotencyKey: "media-reply",
      text: "Chart",
      ...(explicitContent ? { content: [{ type: "text" as const, text: "Chart" }] } : {}),
      mediaUrls: ["https://example.com/chart.png"],
    };
    const first = await appendAssistantMessageToSessionTranscript(params);
    expect(first.ok).toBe(true);
    expect(await appendAssistantMessageToSessionTranscript(params)).toEqual(first);
    await expect(
      appendAssistantMessageToSessionTranscript({
        ...params,
        mediaUrls: ["https://different.example/chart.png"],
      }),
    ).rejects.toThrow("conflicts with the admitted message");
    await expect(
      appendAssistantMessageToSessionTranscript({
        ...params,
        text: "Different",
        ...(explicitContent ? { content: [{ type: "text" as const, text: "Different" }] } : {}),
      }),
    ).rejects.toThrow("conflicts with the admitted message");
    const events = await loadTranscriptEvents(scope);
    expect(
      events.filter((event) => readTranscriptEventMessage(event)?.role === "assistant"),
    ).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          role: "assistant",
          branchDelivery: { mediaUrls: params.mediaUrls },
          content: [{ type: "text", text: explicitContent ? "Chart" : "Chart\nchart.png" }],
        }),
      }),
    ]);
  });
});
