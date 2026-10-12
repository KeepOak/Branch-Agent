import { definePluginEntry } from "./api.js";
import { registerCanopyGatewayMethods } from "./runtime-api.js";
import { createCanopyAutomationNudgeService } from "./src/automation-nudge.js";
import { createCanopyChangeEventService } from "./src/change-events.js";
import { registerCanopyCommand } from "./src/command.js";
import {
  createCanopyLifecycleService,
  readCanopyLifecycleSessions,
  syncCanopyAgentEnded,
  syncCanopySubagentEnded,
} from "./src/lifecycle-sync.js";
import { createCanopySessionsBoardService } from "./src/sessions-board.js";
import { resolveCanopySqliteWorkerModuleUrl } from "./src/sqlite-store-paths.js";
import { registerCanopyStoreLifecycle } from "./src/store-lifecycle.js";
import { CanopyStore } from "./src/store.js";
import { createCanopySessionsBoardTools } from "./src/tools-sessions-board.js";
import { createCanopyTools } from "./src/tools.js";
import {
  guardCanopyToolsForWorkspaceAccess,
  CANOPY_CARD_TOOL_NAMES,
  CANOPY_SESSIONS_BOARD_TOOL_NAMES,
} from "./src/workspace-access.js";

export default definePluginEntry({
  id: "canopy",
  name: "Canopy",
  description: "Dashboard canopy for agent-owned issues and sessions.",
  register(api) {
    const store = CanopyStore.openSqlite(
      resolveCanopySqliteWorkerModuleUrl(api.runtimeSource),
    );
    const resourceServices: Array<{ stop(): void | Promise<void> }> = [];
    registerCanopyStoreLifecycle(api, store, async () => {
      await Promise.all(resourceServices.map(async (service) => await service.stop()));
    });
    const changeEvents = createCanopyChangeEventService(store);
    resourceServices.push(changeEvents);
    const automationNudge = createCanopyAutomationNudgeService({
      store,
    });
    resourceServices.push(automationNudge);
    const sessionsBoard = createCanopySessionsBoardService({
      store,
      gateway: api.runtime.gateway,
    });
    resourceServices.push(sessionsBoard);
    const lifecycleSync = createCanopyLifecycleService({
      store,
      worktrees: api.runtime.worktrees,
      readSessions: async (options) =>
        await readCanopyLifecycleSessions(api.runtime.gateway, options),
    });
    resourceServices.push(lifecycleSync);
    api.session.controls.registerControlUiDescriptor({
      surface: "tab",
      id: "canopy",
      label: "Canopy",
      placement: "route:canopy",
      icon: "kanban",
      group: "control",
      requiredScopes: ["operator.read"],
    });
    api.session.controls.registerControlUiDescriptor({
      surface: "widget",
      id: "board",
      label: "Canopy board",
      requiredScopes: ["operator.read"],
    });
    api.session.controls.registerControlUiDescriptor({
      surface: "widget",
      id: "card",
      label: "Canopy card",
      requiredScopes: ["operator.write"],
    });
    api.session.controls.registerControlUiDescriptor({
      surface: "widget",
      id: "mini",
      label: "Canopy summary",
      requiredScopes: ["operator.read"],
    });
    registerCanopyGatewayMethods({ api, store, sessionsBoard });
    registerCanopyCommand({ api, store });
    api.registerService(changeEvents);
    api.registerService(automationNudge);
    api.registerService(sessionsBoard);
    api.registerService(lifecycleSync);
    api.on("gateway_start", (_event, context) => lifecycleSync.onGatewayStart(context.abortSignal));
    api.on("gateway_stop", () => lifecycleSync.onGatewayStop());
    api.on("subagent_ended", (event) =>
      store.runOperation(async () => {
        await syncCanopySubagentEnded({
          store,
          worktrees: api.runtime.worktrees,
          event,
          onMatched: automationNudge.nudge,
        });
      }),
    );
    api.on("agent_end", (event, context) =>
      store.runOperation(async () => {
        await syncCanopyAgentEnded({
          store,
          event,
          context,
          onMatched: automationNudge.nudge,
        });
      }),
    );
    api.registerCli(
      async ({ program }) => {
        const { registerCanopyCli } = await import("./src/cli.js");
        registerCanopyCli({ program, store });
      },
      {
        descriptors: [
          {
            name: "canopy",
            description: "Manage Canopy cards and worker dispatch",
            hasSubcommands: true,
          },
        ],
      },
    );
    api.registerTool(
      (context) =>
        guardCanopyToolsForWorkspaceAccess(
          createCanopyTools({ context, store }),
          context,
          api.runtime.sandbox.resolveWorkspaceAuthority,
        ),
      {
        names: [...CANOPY_CARD_TOOL_NAMES],
        optional: true,
      },
    );
    // The docked Board agent needs these without a tools.allow entry.
    api.registerTool(
      {
        contextVersion: 2,
        create: (ctx) =>
          createCanopySessionsBoardTools({
            store,
            sessionsBoard,
            caller: { assertCurrent: ctx.assertInvocationCurrent },
          }),
      },
      { names: [...CANOPY_SESSIONS_BOARD_TOOL_NAMES] },
    );
  },
});
