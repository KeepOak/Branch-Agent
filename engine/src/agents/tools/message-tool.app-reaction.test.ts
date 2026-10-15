import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateSessionReactionEvent } from "../../../packages/gateway-protocol/src/index.js";
import {
  appendTranscriptMessage,
  replaceSessionEntry,
} from "../../config/sessions/session-accessor.js";
import { listSessionReactions } from "../../config/sessions/session-reaction-store.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRequestContext } from "../../gateway/server-methods/types.js";
import { withPluginRuntimeGatewayContextResolver } from "../../plugins/runtime/gateway-request-scope.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { jsonResult } from "./common.js";
import { createMessageTool } from "./message-tool-execution.js";

const catalog = { version: 0, channels: [], getChannel: () => undefined } as const;

describe("in-app message reactions", () => {
  it("requires a live Gateway and respects the agent message action allowlist", async () => {
    const options = {
      agentId: "main",
      agentSessionKey: "agent:main:webchat:dm:owner",
      sessionId: "app-reaction-session",
      currentChannelProvider: "webchat",
      currentMessageId: "owner-message",
      preparedMessageToolCatalog: catalog,
    };
    const tool = createMessageTool({ ...options, config: {} });
    await expect(tool.execute("reaction", { action: "react", emoji: "👍" })).rejects.toThrow(
      "active Gateway and session",
    );
    const restricted = createMessageTool({
      ...options,
      config: { tools: { message: { actions: { allow: ["send"] } } } },
    });
    expect(restricted.description).not.toContain("react");
    await expect(restricted.execute("reaction", { action: "react", emoji: "👍" })).rejects.toThrow(
      "disabled for this agent",
    );
  });

  it("stores and broadcasts an agent reaction on an owner message, including removal and retry", async () => {
    await withBranchTestState({ layout: "state-only" }, async (state) => {
      const cfg: BranchConfig = { agents: { entries: { main: {} } } };
      const scope = {
        agentId: "main",
        sessionKey: "agent:main:webchat:dm:owner",
        sessionId: "app-reaction-session",
        storePath: path.join(state.sessionsDir(), "sessions.json"),
      };
      await replaceSessionEntry(scope, { sessionId: scope.sessionId, updatedAt: 1 });
      await appendTranscriptMessage(scope, {
        eventId: "owner-message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          idempotencyKey: "owner-run:user",
        },
      });
      const broadcast = vi.fn();
      const context = {
        broadcast,
        getRuntimeConfig: () => cfg,
      } as unknown as GatewayRequestContext;
      const tool = createMessageTool({
        config: cfg,
        agentId: scope.agentId,
        agentSessionKey: scope.sessionKey,
        sessionId: scope.sessionId,
        currentChannelProvider: "webchat",
        currentMessageId: "owner-run",
        preparedMessageToolCatalog: catalog,
      });
      expect(tool.description).toContain("react");
      const react = (params: Record<string, unknown>) =>
        withPluginRuntimeGatewayContextResolver(
          () => context,
          () => tool.execute("reaction", { action: "react", emoji: "👍", ...params }),
        );
      await react({});
      const expected = [
        { emoji: "👍", count: 1, identities: [{ id: "agent:main", label: "main" }] },
      ];
      expect(listSessionReactions(scope, { sessionId: scope.sessionId })["owner-message"]).toEqual(
        expected,
      );
      expect(broadcast).toHaveBeenCalledWith(
        "session.reaction",
        expect.objectContaining({
          sessionKey: scope.sessionKey,
          sessionId: scope.sessionId,
          messageId: "owner-message",
          action: "added",
          actor: { type: "agent", id: "agent:main", label: "main" },
          reactions: expected,
        }),
        { sessionKeys: [scope.sessionKey], agentId: "main" },
      );
      expect(validateSessionReactionEvent(broadcast.mock.calls[0]?.[1])).toBe(true);
      await react({ channel: "webchat", message_id: "owner-message" });
      await react({ messageId: "owner-run" });
      expect(broadcast).toHaveBeenCalledTimes(1);
      await react({ remove: true });
      expect(
        listSessionReactions(scope, { sessionId: scope.sessionId })["owner-message"],
      ).toBeUndefined();
      expect(broadcast.mock.calls[1]?.[1]).toMatchObject({ action: "removed", reactions: [] });
      await expect(react({ messageId: "missing" })).rejects.toThrow("unknown message");
      await expect(react({ emoji: "not an emoji" })).rejects.toThrow("one emoji grapheme");
      await react({ dryRun: true });
      expect(broadcast).toHaveBeenCalledTimes(2);
      expect(
        listSessionReactions(scope, { sessionId: scope.sessionId })["owner-message"],
      ).toBeUndefined();
      await replaceSessionEntry(scope, { sessionId: "replacement-session", updatedAt: 2 });
      await expect(react({})).rejects.toThrow();
      expect(broadcast).toHaveBeenCalledTimes(2);
    });
  });

  it.each(["slack", "telegram"])(
    "keeps %s reactions on the channel action path",
    async (channel) => {
      const runMessageAction = vi.fn(async () => ({
        kind: "action" as const,
        channel,
        action: "react" as const,
        handledBy: "plugin" as const,
        payload: { ok: true },
        toolResult: jsonResult({ ok: true }),
        dryRun: false,
      }));
      const cfg: BranchConfig = {};
      const tool = createMessageTool({
        config: cfg,
        currentChannelProvider: channel,
        currentChannelId: "owner-chat",
        preparedMessageToolCatalog: catalog,
        runMessageAction,
        getScopedChannelsCommandSecretTargets: () => ({ targetIds: new Set<string>() }),
        resolveCommandSecretRefsViaGateway: async () => ({
          resolvedConfig: cfg,
          diagnostics: [],
          targetStatesByPath: {},
          hadUnresolvedTargets: false,
        }),
      });
      await tool.execute("external-reaction", {
        action: "react",
        messageId: "native-id",
        emoji: "👍",
      });
      expect(runMessageAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "react",
          params: expect.objectContaining({ messageId: "native-id", emoji: "👍" }),
          toolContext: expect.objectContaining({ currentChannelProvider: channel }),
        }),
      );
    },
  );
});
