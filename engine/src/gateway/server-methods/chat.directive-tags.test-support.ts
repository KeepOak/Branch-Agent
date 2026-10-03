import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core";
import { CURRENT_SESSION_VERSION } from "branch/plugin-sdk/agent-sessions";
import { expect } from "vitest";
import type { ReplyBackendHandle } from "../../auto-reply/reply/reply-run-registry.contracts.js";
import {
  loadExactSessionEntryCandidates,
  replaceSessionEntry,
  type SessionAccessScope,
} from "../../config/sessions/session-accessor.js";
import type { CapturedSessionEntryReadSource } from "../../config/sessions/session-entry-read-source.types.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { setGatewayPluginMetadataSnapshot } from "../../plugins/current-plugin-metadata-snapshot.js";
import {
  retainGatewayPluginMetadata,
  type GatewayPluginMetadataOwner,
} from "../../plugins/plugin-metadata-lifecycle.js";
import { loadPluginMetadataSnapshot } from "../../plugins/plugin-metadata-snapshot.js";
import { drainAgentDatabaseResources } from "../../state/branch-agent-db-resources.js";
import {
  disposeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import { closeBranchStateDatabaseByPathAsync } from "../../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../../state/branch-state-db.paths.js";
import { createTestGatewayScheduler } from "../../test-utils/gateway-scheduler-clock.js";
import { resolveSessionStoreAgentId } from "../session-store-key.js";

type ChatDirectiveSessionState = {
  config: Record<string, unknown>;
  mainSessionKey: string;
  sessionEntry: Record<string, unknown>;
  sessionMissing: boolean;
  sessionIdsByKey: Map<string, string>;
  sessionId: string;
  storePath: string;
  transcriptPath: string;
};

export function readChatDirectiveConfig(
  state: Pick<ChatDirectiveSessionState, "config" | "mainSessionKey">,
): BranchConfig {
  return {
    ...state.config,
    session: {
      ...(state.config.session as Record<string, unknown> | undefined),
      mainKey: state.mainSessionKey,
    },
  };
}

export function createChatDirectiveSuiteResources() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-chat-directive-suite-"));
  const databasePath = path.join(root, "branch-agent.sqlite");
  const env = { ...process.env, BRANCH_STATE_DIR: root };
  let metadataOwner: GatewayPluginMetadataOwner | undefined;
  return {
    root,
    databasePath,
    env,
    // The caller retains cleanup ownership before opening can fail.
    open() {
      openBranchAgentDatabase({ agentId: "main", env, path: databasePath });
      // Session cases share the installed inventory through per-case runtime resets.
      metadataOwner = retainGatewayPluginMetadata(createTestGatewayScheduler());
      const snapshot = metadataOwner.runBootstrap(() =>
        loadPluginMetadataSnapshot({ config: {}, allowCurrent: false }),
      );
      metadataOwner.publish(snapshot);
      setGatewayPluginMetadataSnapshot(snapshot, { config: {} });
    },
    loadSessionEntry(
      state: ChatDirectiveSessionState,
      rawKey: string,
      opts?: { agentId?: string },
    ) {
      const canonicalKey =
        typeof state.sessionEntry.canonicalKey === "string"
          ? state.sessionEntry.canonicalKey
          : rawKey === "main"
            ? `agent:${opts?.agentId ?? "main"}:${state.mainSessionKey}`
            : rawKey || `agent:${opts?.agentId ?? "main"}:${state.mainSessionKey}`;
      const entry = state.sessionMissing
        ? undefined
        : {
            sessionId: state.sessionIdsByKey.get(rawKey) ?? state.sessionId,
            sessionFile: state.transcriptPath,
            ...state.sessionEntry,
          };
      const cfg = readChatDirectiveConfig(state);
      let captured: CapturedSessionEntryReadSource | undefined;
      loadExactSessionEntryCandidates({
        readSource: { agentId: "main", path: state.storePath },
        env,
        sessionKeys: [canonicalKey],
        readOnly: true,
        onReadSource: (source) => {
          captured = source;
        },
      });
      const capturedReadSource = expectDefined(captured, "chat directive fixture database source");
      return {
        cfg,
        agentId: resolveSessionStoreAgentId(cfg, rawKey, opts?.agentId),
        storePath: state.storePath,
        store: entry ? { [canonicalKey]: entry } : {},
        entry,
        canonicalKey,
        storeKeys: [canonicalKey],
        readSource: { agentId: capturedReadSource.agentId, path: capturedReadSource.path },
        capturedReadSource,
        capturedReadSources: [capturedReadSource],
      };
    },
    async close() {
      try {
        await drainAgentDatabaseResources({ path: databasePath, agentId: "main" }, async () =>
          disposeBranchAgentDatabaseByPath(databasePath, { env }),
        );
        await closeBranchStateDatabaseByPathAsync(resolveBranchStateSqlitePath(env));
        fs.rmSync(root, { recursive: true, force: true });
      } finally {
        await metadataOwner?.close();
      }
    },
  };
}

export async function seedChatDirectiveFileTranscript(
  scope: SessionAccessScope,
  sessionId: string,
  sessionFile: string,
) {
  fs.writeFileSync(
    sessionFile,
    `${JSON.stringify({
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: "/tmp",
    })}\n`,
    "utf-8",
  );
  // The accessor resolves transcript targets from the persisted store, not the mocked Gateway.
  await replaceSessionEntry(scope, {
    sessionId,
    updatedAt: Date.now(),
  });
}

export function expectClaimOnlyTranscriptMedia(
  message: unknown,
  expectedMedia: unknown[],
  forbiddenValues: string[],
) {
  const media = (
    message as { __branch?: { media?: Array<Record<string, unknown>> } } | undefined
  )?.["__branch"]?.media;
  expect(media).toEqual(expectedMedia);
  for (const fact of media ?? []) {
    expect(fact.url).toMatch(/^media:\/\/inbound\/[^?#]+$/u);
    expect(fact).not.toHaveProperty("path");
    expect(fact).not.toHaveProperty("workspaceDir");
    expect(fact).not.toHaveProperty("data");
  }
  const serialized = JSON.stringify(message);
  expect(serialized).not.toContain("base64");
  for (const value of forbiddenValues) {
    expect(serialized).not.toContain(value);
  }
}

export function createChatDirectiveReplyBackend(params: {
  cancel?: ReplyBackendHandle["cancel"];
  isStopped?: ReplyBackendHandle["isStopped"];
  isStreaming?: ReplyBackendHandle["isStreaming"];
  legacy?: boolean;
  queueMessage: NonNullable<ReplyBackendHandle["queueMessage"]>;
  runId?: string;
  supportsQueueMessageImages?: boolean;
  taskSuggestionDeliveryMode?: "gateway";
}): ReplyBackendHandle {
  return {
    kind: "embedded",
    cancel: params.cancel ?? (() => {}),
    runId: params.runId,
    supportsQueueMessageImages: params.supportsQueueMessageImages,
    taskSuggestionDeliveryMode: params.taskSuggestionDeliveryMode,
    ...(params.legacy
      ? {
          queueMessage: params.queueMessage,
          isStopped: params.isStopped,
          isStreaming: params.isStreaming,
        }
      : {
          // Production steering adapters use V2. The mock queue is this fixture
          // backend's final handoff, so retain the source guard at that boundary.
          messageInjectionV2: {
            version: 2 as const,
            isAvailable: () => true,
            queueMessage: (text, options, assertCurrent) => {
              assertCurrent();
              return params.queueMessage(text, options);
            },
          },
        }),
  };
}
