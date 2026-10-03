import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildModelAliasIndex } from "../../agents/model-selection.js";
import { resetConfigRuntimeState } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { closeBranchAgentDatabasesForTest } from "../../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { createSuiteTempRootTracker } from "../../test-helpers/temp-dir.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { handleDirectiveOnly } from "./directive-handling.impl.js";
import { parseInlineSessionDirectives } from "./directive-handling.parse.js";
import { formatModelSelectionScopeAck } from "./directive-handling.shared.js";
import { applyInlineDirectiveOverrides } from "./get-reply-directives-apply.js";
import { createModelSelectionState } from "./model-selection.js";
import { createTypingController } from "./typing.js";

const parentDir = path.join(os.tmpdir(), "Codex-session-files");
const tempDirs = createSuiteTempRootTracker({ prefix: "chat-model-suitability-", parentDir });
beforeAll(async () => {
  await fs.mkdir(parentDir, { recursive: true });
  await tempDirs.setup();
});
afterAll(async () => {
  await tempDirs.cleanup();
});

function createChatFixtureData(model: string, name: string, root: string) {
  const cfg: BranchConfig = {
    agents: {
      defaults: {
        workspace: root,
        model: { primary: "fixture/gpt-4" },
      },
    },
    models: {
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:1",
          api: "openai-completions",
          models: [],
        },
      },
    },
  };
  const sessionEntry: SessionEntry = {
    sessionId: "suitability",
    updatedAt: Date.now(),
    delivery: { kind: "none" },
  };
  const catalog = [
    {
      provider: "fixture",
      id: model,
      name,
      reasoning: false,
      contextWindow: 8192,
      api: "openai-completions" as const,
    },
  ];
  return { cfg, sessionEntry, catalog };
}

async function applyChatFixture(data: ReturnType<typeof createChatFixtureData>, model: string) {
  const { cfg, sessionEntry, catalog } = data;
  const reply = await handleDirectiveOnly({
    cfg,
    agentId: "main",
    directives: parseInlineSessionDirectives(`/model fixture/${model}`),
    sessionEntry,
    sessionStore: { "agent:main:suitability": sessionEntry },
    sessionKey: "agent:main:suitability",
    elevatedEnabled: false,
    elevatedAllowed: false,
    defaultProvider: "fixture",
    defaultModel: "gpt-4",
    aliasIndex: buildModelAliasIndex({ cfg, defaultProvider: "fixture" }),
    allowedModelKeys: new Set([`fixture/${model}`]),
    allowedModelCatalog: catalog,
    resetModelOverride: false,
    provider: "fixture",
    model: "gpt-4",
    initialModelLabel: "fixture/gpt-4",
    formatModelSwitchEvent: (label) => `Model ${label}`,
    canPersistStickyModelSelection: false,
  });
  return { reply, sessionEntry, cfg };
}

function focusedChatParams(
  data: ReturnType<typeof createChatFixtureData>,
  root: string,
  model: string,
  modelState: Awaited<ReturnType<typeof createModelSelectionState>>,
) {
  const raw = `/model fixture/${model}`;
  return {
    ctx: { Body: raw },
    cfg: data.cfg,
    agentId: "main",
    agentDir: path.join(root, "agent"),
    workspaceDir: root,
    agentCfg: data.cfg.agents?.defaults,
    sessionEntry: data.sessionEntry,
    sessionStore: { "agent:main:suitability": data.sessionEntry },
    sessionKey: "agent:main:suitability",
    sessionScope: undefined,
    isGroup: false,
    allowTextCommands: true,
    command: {
      surface: "cli",
      channel: "cli",
      ownerList: [],
      senderIsOwner: true,
      isAuthorizedSender: true,
      rawBodyNormalized: raw,
      commandBodyNormalized: raw,
    },
    directives: parseInlineSessionDirectives(raw),
    elevatedEnabled: false,
    elevatedAllowed: false,
    elevatedFailures: [],
    defaultProvider: "fixture",
    defaultModel: "gpt-4",
    aliasIndex: buildModelAliasIndex({ cfg: data.cfg, defaultProvider: "fixture" }),
    provider: "fixture",
    model: "gpt-4",
    modelState,
    initialModelLabel: "fixture/gpt-4",
    formatModelSwitchEvent: (label: string) => `Model ${label}`,
    resolvedElevatedLevel: "off" as const,
    defaultActivation: () => "always" as const,
    contextTokens: 8192,
    effectiveModelDirective: `fixture/${model}`,
    typing: createTypingController({}),
  };
}

async function applyFocusedChatFixture(
  data: ReturnType<typeof createChatFixtureData>,
  root: string,
  model: string,
) {
  const modelState = await createModelSelectionState({
    cfg: data.cfg,
    agentId: "main",
    agentCfg: data.cfg.agents?.defaults,
    defaultProvider: "fixture",
    defaultModel: "gpt-4",
    provider: "fixture",
    model: "gpt-4",
    hasModelDirective: true,
    preparedModelCatalog: { entries: data.catalog, routeVariants: data.catalog },
  });
  const result = await applyInlineDirectiveOverrides(
    focusedChatParams(data, root, model, modelState),
  );
  if (result.kind !== "reply" || Array.isArray(result.reply)) {
    throw new Error("Expected the focused model selection acknowledgement");
  }
  return { reply: result.reply, sessionEntry: data.sessionEntry, cfg: data.cfg };
}

async function selectChatFixture(model: string, name: string, focused = false) {
  const root = await tempDirs.make();
  const data = createChatFixtureData(model, name, root);
  return await withEnvAsync(
    {
      BRANCH_STATE_DIR: root,
      BRANCH_HOME: root,
      BRANCH_CONFIG_PATH: path.join(root, "branch.json"),
      BRANCH_WORKSPACE_DIR: undefined,
    },
    async () => {
      resetConfigRuntimeState();
      try {
        return focused
          ? await applyFocusedChatFixture(data, root, model)
          : await applyChatFixture(data, model);
      } finally {
        closeBranchAgentDatabasesForTest();
        closeBranchStateDatabaseForTest();
        resetConfigRuntimeState();
      }
    },
  );
}

describe("native model selection acknowledgement", () => {
  const selectedModel = { provider: "local", model: "falcon-7b" };
  it.each([
    [{ isDefault: true }, "Session model reset to configured default (local/falcon-7b)."],
    [
      { isDefault: false },
      "Model set to local/falcon-7b for this session only; configured default unchanged.",
    ],
    [
      {
        isDefault: false,
        stickyModelSelectionTarget: "agent",
        configuredDefaultUpdate: "requested",
      },
      "Model set to local/falcon-7b for this session. Agent default update requested.",
    ],
    [
      {
        isDefault: false,
        stickyModelSelectionTarget: "defaults",
        configuredDefaultUpdate: "skipped-immutable",
      },
      "Model set to local/falcon-7b for this session. Global default unchanged because configuration is immutable.",
    ],
  ] as const)("preserves the scope acknowledgement and appends advice: %j", (scope, message) => {
    const reply = formatModelSelectionScopeAck({
      ...scope,
      label: "local/falcon-7b",
      selectedModel,
    });
    expect(reply).toBe(
      `${message} Warning: Model "falcon-7b" is not among the model families recommended for agentic use. Reasoning and tool calling capabilities may be limited; selection remains available.`,
    );
  });

  it("evaluates native model ID even when the selected alias has no family name", () => {
    expect(
      formatModelSelectionScopeAck({
        isDefault: false,
        label: "work (custom/gpt-4)",
        selectedModel: { provider: "custom", model: "gpt-4" },
      }),
    ).toBe("Model set to work (custom/gpt-4) for this session only; configured default unchanged.");
  });

  it("recognizes catalog display names and preserves names containing slashes", () => {
    const catalog = [{ provider: "local", id: "falcon-7b", name: "local/my-model" }] as const;
    const base = { isDefault: false, label: "local/falcon-7b", selectedModel };
    expect(formatModelSelectionScopeAck({ ...base, modelCatalog: catalog })).toContain(
      'Warning: Model "local/my-model"',
    );
    expect(
      formatModelSelectionScopeAck({
        ...base,
        modelCatalog: [{ ...catalog[0], name: "Llama 3.3 70B" }],
      }),
    ).not.toContain("Warning:");
  });

  it.each([false, true])(
    "warns after actual directive acceptance (focused: %s)",
    async (focused) => {
      const { reply, sessionEntry, cfg } = await selectChatFixture(
        "falcon-7b",
        "Local Falcon",
        focused,
      );
      expect(reply?.isError).not.toBe(true);
      expect(reply?.text).toContain("Model set to fixture/falcon-7b for this session only");
      expect(reply?.text).toContain('Warning: Model "Local Falcon"');
      expect(sessionEntry.providerOverride).toBe("fixture");
      expect(sessionEntry.modelOverride).toBe("falcon-7b");
      expect(cfg.agents?.defaults?.model).toEqual({ primary: "fixture/gpt-4" });
    },
  );

  it("omits advice for a recognized family in an opaque native deployment", async () => {
    const { reply, sessionEntry } = await selectChatFixture("opaque", "Qwen Max");
    expect(reply?.isError).not.toBe(true);
    expect(reply?.text).not.toContain("Warning:");
    expect(sessionEntry.modelOverride).toBe("opaque");
  });
});
