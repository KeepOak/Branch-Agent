import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expectDefined } from "@branch/normalization-core/expect";
import { describe, expect, it, vi } from "vitest";
import {
  appendTranscriptMessage,
  upsertSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { chatHistoryHandlers } from "./chat-history-handler.js";
import { createHistoryReadContext } from "./chat-history.test-helpers.js";
import { identifiedClient } from "./sessions-read-cache.test-support.js";
import { sessionRewindHandlers } from "./sessions-rewind.js";
import type { RespondFn } from "./types.js";

describe("session segments", () => {
  it("lists the previousSessionId chain and reads only one authorized generation at a time", async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const cfg = {
        agents: { ownership: "explicit", entries: { research: {} } },
      } satisfies BranchConfig;
      await state.writeConfig(cfg);
      const sessionKey = "agent:research:main";
      const otherKey = "agent:research:other";
      for (const [index, sessionId] of ["first", "second", "third"].entries()) {
        const scope = { agentId: "research", sessionKey, sessionId };
        await upsertSessionEntryCore(scope, {
          sessionId,
          updatedAt: index + 1,
          ...(index > 0 ? { previousSessionId: ["first", "second"][index - 1] } : {}),
        });
        await appendTranscriptMessage(scope, {
          message: { role: "user", content: `Page ${sessionId}`, timestamp: index + 1 },
        });
      }
      await upsertSessionEntryCore(
        { agentId: "research", sessionKey: otherKey },
        { sessionId: "unrelated", updatedAt: 4 },
      );
      await appendTranscriptMessage(
        { agentId: "research", sessionKey: otherKey, sessionId: "unrelated" },
        { message: { role: "user", content: "Unrelated", timestamp: 4 } },
      );
      const database = new DatabaseSync(
        path.join(state.agentDir("research"), "branch-agent.sqlite"),
      );
      try {
        database
          .prepare(
            "INSERT INTO session_windows (session_id, session_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run("unlinked", sessionKey, 5, 5);
      } finally {
        database.close();
      }
      const context = await createHistoryReadContext({ getRuntimeConfig: () => cfg });
      const client = identifiedClient("segments-operator");
      client.connect.scopes = ["operator.admin"];
      const call = async (method: "sessions.segments.list" | "chat.history", params: object) => {
        const respond = vi.fn<RespondFn>();
        const handler =
          method === "chat.history"
            ? chatHistoryHandlers["chat.history"]
            : sessionRewindHandlers["sessions.segments.list"];
        await expectDefined(
          handler,
          `${method} handler`,
        )({
          params: { sessionKey, agentId: "research", ...params },
          context,
          client,
          respond,
          req: { type: "req", id: "segments", method },
          isWebchatConnect: () => false,
        });
        return respond;
      };
      expect(await call("sessions.segments.list", {})).toHaveBeenCalledWith(true, {
        segments: [
          expect.objectContaining({ sessionId: "third", current: true }),
          expect.objectContaining({ sessionId: "second", current: false }),
          expect.objectContaining({ sessionId: "first", current: false }),
        ],
      });
      for (const sessionId of ["first", "second", "third"]) {
        expect(await call("chat.history", { sessionId })).toHaveBeenCalledWith(
          true,
          expect.objectContaining({
            sessionId,
            messages: [expect.objectContaining({ content: `Page ${sessionId}` })],
          }),
        );
      }
      for (const sessionId of ["unlinked", "unrelated", "missing"]) {
        expect(await call("chat.history", { sessionId })).toHaveBeenCalledExactlyOnceWith(
          false,
          undefined,
          expect.objectContaining({
            code: "INVALID_REQUEST",
            message: "sessionId does not belong to sessionKey",
          }),
        );
      }
    });
  });
});
