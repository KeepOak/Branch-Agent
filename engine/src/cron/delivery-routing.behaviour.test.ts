// Written by Branch for AUTOMATION-0040 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/cron/delivery.ts and src/cron/delivery-preview.ts; preserves newer current-session routing.
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceSessionEntrySync } from "../config/sessions/session-accessor.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  createChannelTestPluginBase,
  createDirectOutboundTestAdapter,
  createTestRegistry,
} from "../test-utils/channel-plugins.js";
import { normalizeSessionDeliveryState } from "../utils/delivery-context.shared.js";
import { resolveCronDeliveryPlan } from "./delivery-plan.js";
import { resolveCronDeliveryPreviews } from "./delivery-preview.js";
import { assertCronDeliveryInputNonBlankFields } from "./delivery-target-validation.js";
import { makeCronJob } from "./delivery.test-helpers.js";
import { resolveDeliveryTarget } from "./isolated-agent/delivery-target.js";
import type { CronDelivery } from "./types.js";

afterEach(() => resetPluginRuntimeStateForTest());

describe("AUTOMATION-0040 result delivery routing", () => {
  it("previews origin, home, platform, webhook and quiet routes without sending", async () => {
    await withBranchTestState({ layout: "home" }, async (state) => {
      const sendText = vi.fn();
      setActivePluginRegistry(
        createTestRegistry(
          ["telegram", "discord"].map((id) => ({
            pluginId: id,
            plugin: {
              ...createChannelTestPluginBase({ id }),
              outbound: { ...createDirectOutboundTestAdapter({ channel: id }), sendText },
              messaging: { targetPrefixes: [id] },
            },
            source: "test",
          })),
        ),
      );
      const sessionKey = "agent:main:telegram:direct:origin-chat";
      const storePath = path.join(state.sessionsDir(), "sessions.json");
      const cfg: BranchConfig = {
        agents: { entries: { main: { workspace: state.workspaceDir } } },
        session: { store: storePath },
      };
      replaceSessionEntrySync(
        { agentId: "main", sessionKey, storePath },
        {
          sessionId: "origin-session",
          updatedAt: 1,
          delivery: normalizeSessionDeliveryState({
            context: { channel: "telegram", to: "origin-chat", accountId: "work", threadId: "42" },
          }),
        },
      );
      const routes: Array<{ id: string; delivery: CronDelivery }> = [
        { id: "origin", delivery: { mode: "announce", channel: "last" } },
        { id: "home", delivery: { mode: "announce", channel: "telegram", to: "home-chat" } },
        { id: "platform", delivery: { mode: "announce", to: "discord:channel:reports" } },
        { id: "webhook", delivery: { mode: "webhook", to: "https://example.com/completed" } },
        { id: "quiet", delivery: { mode: "none" } },
      ];
      const jobs = routes.map(({ id, delivery }) =>
        makeCronJob({
          id,
          delivery,
          agentId: "main",
          sessionKey,
        }),
      );
      expect(await resolveCronDeliveryPreviews({ cfg, jobs })).toEqual({
        origin: {
          label: "announce -> telegram:origin-chat",
          detail: `resolved from last, session ${sessionKey}`,
        },
        home: { label: "announce -> telegram:home-chat", detail: "explicit" },
        platform: { label: "announce -> discord:channel:reports", detail: "explicit" },
        webhook: { label: "webhook:https://example.com/completed", detail: "webhook" },
        quiet: { label: "not requested", detail: "not requested" },
      });
      const origin = resolveCronDeliveryPlan(jobs[0]!);
      expect(await resolveDeliveryTarget(cfg, "main", { ...origin, sessionKey })).toMatchObject({
        ok: true,
        channel: "telegram",
        to: "origin-chat",
        accountId: "work",
        threadId: "42",
      });
      expect(resolveCronDeliveryPlan(jobs[2]!)).toMatchObject({
        mode: "announce",
        channel: "discord",
        to: "discord:channel:reports",
        requested: true,
      });
      expect(sendText).not.toHaveBeenCalled();
    });
  });

  it("keeps a current conversation completion local when there is no external route", async () => {
    await withBranchTestState({ layout: "home" }, async (state) => {
      setActivePluginRegistry(createTestRegistry());
      const job = makeCronJob({
        agentId: "main",
        sessionTarget: "current",
        sessionKey: "agent:main:dashboard:origin",
        delivery: { mode: "announce" },
      });
      const cfg: BranchConfig = {
        agents: { entries: { main: { workspace: state.workspaceDir } } },
      };
      expect(await resolveCronDeliveryPreviews({ cfg, jobs: [job] })).toEqual({
        [job.id]: {
          label: "announce -> current session",
          detail: "commits to this conversation (no external channel route)",
        },
      });
    });
  });

  it.each(["to", "channel"])("rejects a blank %s instead of silently rerouting", (field) => {
    expect(() => assertCronDeliveryInputNonBlankFields({ mode: "announce", [field]: " " })).toThrow(
      `delivery.${field} must be a non-empty string`,
    );
  });
});
