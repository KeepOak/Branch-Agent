import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { MEMORY_RINGS_SYSTEM_EVENT_TEXT } from "branch/plugin-sdk/memory-core-host-status";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";
import { enqueueSystemEvent } from "branch/plugin-sdk/system-event-runtime";
import { resetSystemEventsForTest } from "branch/plugin-sdk/test-fixtures";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerShortTermPromotionRings } from "./rings.js";

let previousConfig: ReturnType<typeof getRuntimeConfigSnapshot>;

beforeEach(() => {
  previousConfig = getRuntimeConfigSnapshot();
  resetSystemEventsForTest();
});

afterEach(() => {
  resetSystemEventsForTest();
  if (previousConfig) {
    setRuntimeConfigSnapshot(previousConfig);
  } else {
    clearRuntimeConfigSnapshot();
  }
});

it.each(
  ["global", "global:heartbeat"].flatMap((sessionKey) =>
    ["main", "research"].map((queuedAgentId) => ({ sessionKey, queuedAgentId })),
  ),
)(
  "checks $sessionKey against its heartbeat owner, with an event for $queuedAgentId",
  async ({ sessionKey, queuedAgentId }) => {
    const config: BranchConfig = {
      agents: { entries: { main: { default: true }, research: {} } },
      session: { scope: "global" },
      plugins: { entries: { "memory-core": { config: { rings: { enabled: false } } } } },
    };
    setRuntimeConfigSnapshot(config);
    const on = vi.fn<BranchPluginApi["on"]>();
    const api = createTestPluginApi({ id: "memory-core", config, on });
    registerShortTermPromotionRings(api);
    const registration = on.mock.calls.find(([name]) => name === "before_agent_reply");
    expect(registration).toBeDefined();
    const beforeReply = registration![1] as Parameters<typeof api.on<"before_agent_reply">>[1];
    expect(
      enqueueSystemEvent(MEMORY_RINGS_SYSTEM_EVENT_TEXT, {
        sessionKey: `agent:${queuedAgentId}:global`,
        contextKey: "cron:memory-rings",
      }),
    ).toBe(true);

    const result = await beforeReply(
      { cleanedBody: MEMORY_RINGS_SYSTEM_EVENT_TEXT },
      { agentId: "research", trigger: "heartbeat", sessionKey, workspaceDir: "." },
    );

    expect(result).toEqual(
      queuedAgentId === "research"
        ? { handled: true, reason: "memory-core: short-term rings disabled" }
        : undefined,
    );
  },
);
