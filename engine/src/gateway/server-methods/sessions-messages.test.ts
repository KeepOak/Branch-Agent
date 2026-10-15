import { describe, expect, it } from "vitest";
import { projectChatDisplayMessages } from "../chat-display-projection.core.js";
import { readSessionMessageByIdAsync } from "../session-transcript-readers.js";
import {
  appendMessage,
  call,
  client,
  context,
  roleConfig,
  seedSession,
  sessionKey,
  transcriptScope,
  withReactionState,
} from "./sessions-reactions.test-support.js";

async function readMessage(messageId: string, scope = transcriptScope) {
  const read = await readSessionMessageByIdAsync(scope, messageId, {
    currentOnly: true,
    maxBytes: Number.MAX_SAFE_INTEGER,
    allowResetArchiveFallback: false,
  });
  return read.message as Record<string, unknown>;
}

describe("sessions.messages.pin and sessions.messages.delete", () => {
  it("pins and unpins one message, and chat.history's projection carries the pin", async () => {
    await withReactionState(async () => {
      await seedSession();
      const messageId = await appendMessage();
      const pin = (pinned: boolean) =>
        call("sessions.messages.pin", { sessionKey, messageId, pinned }, client("owner"));
      expect(await pin(true)).toMatchObject([true, { messageId, pinned: true }]);
      const pinned = await readMessage(messageId);
      expect(pinned.pinned).toBe(true);
      expect(projectChatDisplayMessages([pinned])).toEqual([
        expect.objectContaining({ role: "user", pinned: true }),
      ]);
      expect(await pin(false)).toMatchObject([true, { messageId, pinned: false }]);
      const unpinned = await readMessage(messageId);
      expect(unpinned.pinned).toBeUndefined();
      expect(projectChatDisplayMessages([unpinned])[0]).not.toHaveProperty("pinned");
    });
  });

  it("deletes one message from chat.history and from model context, leaving its neighbours", async () => {
    await withReactionState(async () => {
      await seedSession();
      const kept = await appendMessage({
        role: "user",
        content: [{ type: "text", text: "keep me" }],
      });
      const doomed = await appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "delete me" }],
      });
      await call(
        "sessions.messages.pin",
        { sessionKey, messageId: doomed, pinned: true },
        client("owner"),
      );
      expect(
        await call("sessions.messages.delete", { sessionKey, messageId: doomed }, client("owner")),
      ).toMatchObject([true, { messageId: doomed, deleted: true }]);
      const deleted = await readMessage(doomed);
      expect(deleted).toMatchObject({ display: false, excludeFromContext: true });
      expect(deleted.pinned).toBeUndefined();
      expect(typeof deleted.deletedAt).toBe("number");
      const projected = projectChatDisplayMessages([await readMessage(kept), deleted]);
      expect(projected).toHaveLength(1);
      expect(projected[0]).toMatchObject({ role: "user" });
    });
  });

  it("refuses an unknown message and a view-only member without changing the transcript", async () => {
    await withReactionState(async () => {
      await seedSession();
      const unknown = await call(
        "sessions.messages.delete",
        { sessionKey, messageId: "no-such-message" },
        client("owner"),
      );
      expect(unknown[0]).toBe(false);
      expect(unknown[2]).toMatchObject({ code: "INVALID_REQUEST", message: "unknown message" });

      const key = "agent:main:messages-view";
      const scope = await seedSession({ visibility: "shared", sessionId: "messages-view" }, key);
      const messageId = await appendMessage(undefined, scope);
      for (const [method, params] of [
        ["sessions.messages.pin", { sessionKey: key, messageId, pinned: true }],
        ["sessions.messages.delete", { sessionKey: key, messageId }],
      ] as const) {
        const refused = await call(method, params, client("viewer"), context(roleConfig("view")));
        expect(refused[0]).toBe(false);
      }
      const untouched = await readMessage(messageId, scope);
      expect(untouched.pinned).toBeUndefined();
      expect(untouched.display).toBeUndefined();
    });
  });
});
