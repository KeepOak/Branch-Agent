import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { loadTranscriptEventsSync } from "../../config/sessions/session-accessor.sqlite-read.js";
import { addSessionMember } from "../../config/sessions/session-sharing-store.native.js";
import { publishSystemEventStoreConfig } from "../../config/sessions/session-store-path.js";
import type { MessageActionInput } from "../../infra/outbound/message-action-contracts.js";
import { publishSystemEventStoreResolver } from "../../infra/system-event-ownership.js";
import {
  drainSystemEventEntries,
  peekSystemEventEntries,
  resetSystemEventsForTest,
} from "../../infra/system-events.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { readSessionMessageByIdAsync } from "../session-transcript-readers.js";
import {
  appendMessage,
  call,
  client,
  context,
  roleConfig,
  seedSession,
  sessionId,
  sessionKey,
  transcriptScope,
  withReactionState,
} from "./sessions-reactions.test-support.js";

const runMessageAction = vi.hoisted(() => vi.fn());
// mock-isolation: reaction mirroring is asserted through the outbound action runner, so each file replaces it.
vi.mock("../../infra/outbound/message-action-runner.js", () => ({ runMessageAction }));

beforeEach(() => {
  runMessageAction.mockReset().mockImplementation(async (input: MessageActionInput) => {
    await input.onPlatformSendDispatch?.();
    input.assertDirectAdapterHandoff?.();
    return {
      kind: "action",
      channel: "testchat",
      action: "react",
      handledBy: "plugin",
      payload: { ok: true },
      dryRun: false,
    };
  });
});

afterEach(() => {
  resetSystemEventsForTest();
  setActivePluginRegistry(createTestRegistry());
  vi.restoreAllMocks();
});

describe("session reaction handlers", () => {
  it("leaves a message out of model context and puts it back without removing its transcript entry", async () => {
    await withReactionState(async () => {
      await seedSession();
      const messageId = await appendMessage();
      const set = (exclude: boolean) =>
        call("session.context.set", { sessionKey, messageId, exclude }, client("owner"));
      expect(await set(true)).toMatchObject([true, { messageId, excluded: true }]);
      const read = async () =>
        (
          await readSessionMessageByIdAsync(transcriptScope, messageId, {
            currentOnly: true,
            maxBytes: Number.MAX_SAFE_INTEGER,
            allowResetArchiveFallback: false,
          })
        ).message as Record<string, unknown>;
      expect((await read()).excludeFromContext).toBe(true);
      expect(await set(false)).toMatchObject([true, { messageId, excluded: false }]);
      expect((await read()).excludeFromContext).toBeUndefined();
    });
  });
  it("refuses a suggest-only member changing model context", async () => {
    await withReactionState(async () => {
      const key = "agent:main:context-suggest";
      const scope = await seedSession({ visibility: "suggest", sessionId: "context-suggest" }, key);
      const messageId = await appendMessage(undefined, scope);
      expect(
        (
          await call(
            "session.reactions.set",
            { sessionKey: key, messageId, emoji: "👍" },
            client("viewer"),
            context(roleConfig("suggest")),
          )
        )[0],
      ).toBe(true);
      const result = await call(
        "session.context.set",
        { sessionKey: key, messageId, exclude: true },
        client("viewer"),
        context(roleConfig("suggest")),
      );
      expect(result[0]).toBe(false);
      expect(result[2]).toMatchObject({
        code: "INVALID_REQUEST",
        details: { code: "SESSION_PARTICIPATION_REQUIRED" },
      });
      const read = await readSessionMessageByIdAsync(scope, messageId, {
        currentOnly: true,
        maxBytes: Number.MAX_SAFE_INTEGER,
        allowResetArchiveFallback: false,
      });
      expect((read.message as Record<string, unknown>).excludeFromContext).toBeUndefined();
    });
  });
  it("enforces session participation and operator caps before committing reactions", async () => {
    await withReactionState(async () => {
      const cases = [
        { name: "draft owner", identity: "owner", visibility: "draft", allowed: true },
        { name: "draft admin", identity: "admin", admin: true, visibility: "draft", allowed: true },
        {
          name: "draft member",
          identity: "member",
          member: true,
          visibility: "draft",
          allowed: false,
        },
        {
          name: "read-only member",
          identity: "member",
          member: true,
          visibility: "read-only",
          allowed: true,
        },
        { name: "shared viewer", identity: "viewer", visibility: "shared", allowed: true },
        {
          name: "write-capped shared viewer",
          identity: "viewer",
          cap: "write",
          visibility: "shared",
          allowed: true,
        },
        {
          name: "suggest-capped suggest viewer",
          identity: "viewer",
          cap: "suggest",
          visibility: "suggest",
          allowed: true,
        },
        {
          name: "view-capped suggest viewer",
          identity: "viewer",
          cap: "view",
          visibility: "suggest",
          allowed: false,
          viewDenied: true,
        },
        {
          name: "view-capped owner",
          identity: "owner",
          cap: "view",
          visibility: "shared",
          allowed: true,
        },
        {
          name: "none-capped viewer",
          identity: "viewer",
          cap: "none",
          visibility: "shared",
          allowed: false,
        },
        {
          name: "none-capped owner",
          identity: "owner",
          cap: "none",
          visibility: "shared",
          allowed: false,
        },
        {
          name: "suggest-capped shared viewer",
          identity: "viewer",
          cap: "suggest",
          visibility: "shared",
          allowed: false,
        },
        { name: "read-only viewer", identity: "viewer", visibility: "read-only", allowed: false },
      ] as const;
      for (const [index, scenario] of cases.entries()) {
        const key = `agent:main:reaction-access-${index}`;
        const scope = await seedSession(
          { visibility: scenario.visibility, sessionId: `access-${index}` },
          key,
        );
        if ("member" in scenario) {
          addSessionMember(scope, {
            identityId: "member",
            addedBy: "owner",
            expectedSessionId: scope.sessionId,
          });
        }
        const messageId = await appendMessage(undefined, scope);
        const requestContext = context("cap" in scenario ? roleConfig(scenario.cap) : {});
        const result = await call(
          "session.reactions.set",
          { sessionKey: key, messageId, emoji: "👍" },
          client(scenario.identity, scenario.identity, "admin" in scenario),
          requestContext,
        );
        expect(result[0], scenario.name).toBe(scenario.allowed);
        if ("viewDenied" in scenario) {
          expect(result[2]).toMatchObject({
            code: "FORBIDDEN",
            message: "your operator role permits viewing sessions only",
          });
        }
        if (!scenario.allowed) {
          expect(requestContext.broadcast, scenario.name).not.toHaveBeenCalled();
          expect(peekSystemEventEntries(key), scenario.name).toEqual([]);
        }
      }
    });
  });

  it("lets read-only viewers list everyone's reactions while hiding none-capped and incognito sessions", async () => {
    await withReactionState(async () => {
      await seedSession({ visibility: "read-only" });
      const messageId = await appendMessage();
      await call(
        "session.reactions.set",
        { sessionKey, messageId, emoji: "👍" },
        client("owner", "Owner"),
      );
      const listed = await call(
        "session.reactions.list",
        { sessionKey },
        client("viewer"),
        context(roleConfig("view")),
      );
      expect(listed).toMatchObject([
        true,
        {
          sessionId,
          reactions: {
            [messageId]: [{ emoji: "👍", count: 1, identities: [{ id: "owner", label: "Owner" }] }],
          },
        },
      ]);
      const hidden = await call(
        "session.reactions.list",
        { sessionKey },
        client("viewer"),
        context(roleConfig("none")),
      );
      expect(hidden[0]).toBe(false);
      expect(hidden[2]).toMatchObject({
        code: "INVALID_REQUEST",
        message: `unknown session: ${sessionKey}`,
      });

      const incognitoKey = "agent:main:dashboard:incognito-reactions";
      const incognitoScope = await seedSession(
        { incognito: true, sessionId: "incognito-reactions" },
        incognitoKey,
      );
      const incognitoMessageId = await appendMessage(undefined, incognitoScope);
      for (const method of ["session.reactions.set", "session.reactions.list"] as const) {
        const result = await call(
          method,
          {
            sessionKey: incognitoKey,
            ...(method.endsWith("set") ? { messageId: incognitoMessageId, emoji: "👍" } : {}),
          },
          client("owner"),
        );
        expect(result[0]).toBe(false);
        expect(result[2]).toMatchObject({
          message: `Incognito session "${incognitoKey}" was not found.`,
        });
      }
      const admin = client("admin", "Admin", true);
      expect(
        (
          await call(
            "session.reactions.set",
            { sessionKey: incognitoKey, messageId: incognitoMessageId, emoji: "👍" },
            admin,
          )
        )[0],
      ).toBe(true);
      expect(
        (await call("session.reactions.list", { sessionKey: incognitoKey }, admin))[1],
      ).toMatchObject({
        sessionId: "incognito-reactions",
        reactions: { [incognitoMessageId]: [{ count: 1 }] },
      });
    });
  });

  it("requires an identified author and one emoji grapheme", async () => {
    await withReactionState(async () => {
      await seedSession();
      const messageId = await appendMessage();
      const unidentified = await call(
        "session.reactions.set",
        { sessionKey, messageId, emoji: "👍" },
        null,
      );
      expect(unidentified[2]).toMatchObject({
        code: "INVALID_REQUEST",
        message: "identified reaction author required",
      });
      for (const emoji of [
        "",
        "hello",
        "👍👍",
        "a👍",
        "👍 ",
        "🇺",
        "1",
        "\u200d",
        `🏴${"\u{e0067}".repeat(31)}\u{e007f}`,
      ]) {
        const requestContext = context();
        const result = await call(
          "session.reactions.set",
          { sessionKey, messageId, emoji },
          client("alice"),
          requestContext,
        );
        expect(result[0], JSON.stringify(emoji)).toBe(false);
        expect(result[2]).toMatchObject({ code: "INVALID_REQUEST" });
        expect(requestContext.broadcast).not.toHaveBeenCalled();
      }
      for (const emoji of ["👍", "❤️", "👩🏽‍💻", "1️⃣", "🇦🇹"]) {
        expect(
          (await call("session.reactions.set", { sessionKey, messageId, emoji }))[0],
          emoji,
        ).toBe(true);
      }
    });
  });

  it("rejects missing, tool, and previous-session message ids", async () => {
    await withReactionState(async () => {
      await seedSession();
      const toolId = await appendMessage({
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        content: [{ type: "text", text: "tool result" }],
        isError: false,
        timestamp: 1,
      });
      const oldMessageId = await appendMessage(undefined, {
        ...transcriptScope,
        sessionId: "previous-session",
      });
      const requestContext = context();
      for (const messageId of ["unknown", toolId, oldMessageId]) {
        const result = await call(
          "session.reactions.set",
          { sessionKey, messageId, emoji: "👍" },
          client("alice"),
          requestContext,
        );
        expect(result[2]).toMatchObject({ code: "INVALID_REQUEST", message: "unknown message" });
      }
      expect(requestContext.broadcast).not.toHaveBeenCalled();
      expect(peekSystemEventEntries(sessionKey)).toEqual([]);
    });
  });

  it("broadcasts committed summaries and queues next-turn system events without changing transcript bytes", async () => {
    await withReactionState(async () => {
      await seedSession();
      const messageId = await appendMessage();
      const transcript = loadTranscriptEventsSync(transcriptScope);
      const requestContext = context();
      // The running Gateway publishes a physical-path resolver; the freshness
      // guard must accept queued reactions even when the state dir is symlinked
      // (macOS temp roots), which a resolver-less queue never exercises.
      publishSystemEventStoreConfig({});
      onTestFinished(() => publishSystemEventStoreResolver(undefined));
      for (const remove of [false, true, false]) {
        const action = remove ? "removed" : "added";
        const reactions = remove
          ? []
          : [{ emoji: "👍", count: 1, identities: [{ id: "alice", label: "Alice" }] }];
        const response = await call(
          "session.reactions.set",
          { sessionKey: "main", messageId, emoji: "👍", remove },
          client("alice", "Alice"),
          requestContext,
        );
        expect(response).toMatchObject([
          true,
          { messageId, reactions, mirror: { status: "skipped", reason: expect.any(String) } },
        ]);
        expect(requestContext.broadcast).toHaveBeenLastCalledWith(
          "session.reaction",
          {
            sessionKey,
            agentId: "main",
            sessionId,
            messageId,
            emoji: "👍",
            action,
            actor: { type: "human", id: "alice", label: "Alice" },
            reactions,
          },
          { sessionKeys: [sessionKey, "main"], agentId: "main" },
        );
        expect((await call("session.reactions.list", { sessionKey }))[1]).toEqual({
          sessionId,
          reactions: remove ? {} : { [messageId]: reactions },
        });
      }
      const events = drainSystemEventEntries(sessionKey);
      expect(events.map(({ text }) => text)).toEqual(
        ["added", "removed", "added"].map(
          (action) => `Control UI reaction ${action}: 👍 by Alice on msg ${messageId} from Riley`,
        ),
      );
      expect(new Set(events.map(({ contextKey }) => contextKey)).size).toBe(3);
      // Repeating the last addition changes nothing, so nothing is announced.
      const broadcasts = vi.mocked(requestContext.broadcast).mock.calls.length;
      expect(
        await call(
          "session.reactions.set",
          { sessionKey: "main", messageId, emoji: "👍" },
          client("alice", "Alice"),
          requestContext,
        ),
      ).toMatchObject([
        true,
        {
          reactions: [{ emoji: "👍", count: 1 }],
          mirror: { status: "skipped", reason: "reaction already in that state" },
        },
      ]);
      expect(requestContext.broadcast).toHaveBeenCalledTimes(broadcasts);
      expect(peekSystemEventEntries(sessionKey)).toEqual([]);
      expect(runMessageAction).not.toHaveBeenCalled();
      expect(loadTranscriptEventsSync(transcriptScope)).toEqual(transcript);
    });
  });

  it("reports own prompts and assistant replies with author label fallbacks", async () => {
    await withReactionState(async () => {
      await seedSession();
      for (const [message, author] of [
        [
          {
            role: "user",
            content: "own prompt",
            __branch: { senderName: "Alice", senderId: "alice" },
          },
          "Alice",
        ],
        [
          {
            role: "user",
            content: "username prompt",
            __branch: { senderUsername: "riley", senderId: "peer-id" },
          },
          "riley",
        ],
        [{ role: "user", content: "id prompt", __branch: { senderId: "peer-id" } }, "peer-id"],
        [{ role: "assistant", content: "assistant reply" }, "assistant"],
      ] as const) {
        const messageId = await appendMessage(message);
        expect(
          (await call("session.reactions.set", { sessionKey, messageId, emoji: "🎉" }))[0],
        ).toBe(true);
        expect(drainSystemEventEntries(sessionKey)).toMatchObject([
          { text: `Control UI reaction added: 🎉 by Alice on msg ${messageId} from ${author}` },
        ]);
      }
    });
  });
});
