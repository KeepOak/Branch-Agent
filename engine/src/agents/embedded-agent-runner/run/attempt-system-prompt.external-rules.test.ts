// Actual admitted prompt preparation, AgentSession installation and isolated provider transport.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { root as fsRoot } from "../../../infra/fs-safe.js";
import type { AssistantMessage, Context } from "../../../llm/types.js";
import { createAssistantMessageEventStream } from "../../../llm/utils/event-stream.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../../../test-utils/branch-test-state.js";
import { prepareSystemAgentRunAdmission } from "../../admitted-run-context.js";
import { buildBootstrapBudgetState } from "../../bootstrap-budget.js";
import { isMissingExternalRule } from "../../external-project-rules.files.js";
import { toggleExternalProjectRule } from "../../external-project-rules.js";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "../../sessions/index.js";
import { createAgentSession } from "../../sessions/sdk.js";
import { makeProviderModelFixture } from "../../test-helpers/provider-model-fixture.js";
import { registerAgentWorkspaceAccess } from "../../workspace-access.js";
import { createAttemptSetupFixture } from "./attempt-setup.test-support.js";
import { prepareEmbeddedAttemptSystemPrompt } from "./attempt-system-prompt-prepare.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

let state: BranchTestState | undefined;
const close: Array<() => void> = [];
afterEach(async () => {
  for (const dispose of close.splice(0)) dispose();
  await state?.cleanup();
  state = undefined;
});

function attemptFor(
  fixture: BranchTestState,
  admitted: EmbeddedRunAttemptParams["admittedRunContext"],
): EmbeddedRunAttemptParams {
  const config = {
    agents: {
      ownership: "explicit" as const,
      entries: {
        main: {
          workspace: fixture.workspaceDir,
          agentDir: fixture.agentDir(),
        },
      },
    },
    plugins: { enabled: false },
  };
  const authStorage = AuthStorage.inMemory();
  return {
    provider: "openai",
    modelId: "gpt-5.6-luna",
    model: makeProviderModelFixture({
      id: "gpt-5.6-luna",
      provider: "openai",
      api: "openai-responses",
      baseUrl: "https://fixture.invalid",
    }),
    config,
    admittedRunContext: admitted,
    abortSignal: new AbortController().signal,
    sessionId: "external-rules",
    sessionKey: "agent:main:external-rules",
    sessionFile: "fixture-session",
    workspaceDir: fixture.workspaceDir,
    agentDir: fixture.agentDir(),
    prompt: "Edit src/index.ts",
    promptMode: "full",
    runId: "external-rules",
    timeoutMs: 60_000,
    thinkLevel: "off",
    extraSystemPrompt: "UNRELATED_EXTRA",
    authProfileStore: { version: 1, profiles: {} },
    authStorage,
    modelRegistry: ModelRegistry.inMemory(authStorage),
  };
}

function parameters(
  attempt: EmbeddedRunAttemptParams,
): Parameters<typeof prepareEmbeddedAttemptSystemPrompt>[0] {
  return {
    attempt,
    activeContextEngine: undefined,
    bootstrap: {
      ...buildBootstrapBudgetState({ files: [] }),
      bootstrapMode: "full" as const,
      contextFiles: [
        { path: path.join(attempt.workspaceDir, "SOUL.md"), content: "UNRELATED_SOUL" },
      ],
      bootstrapInjectionStats: [],
      shouldRecordCompletedBootstrapTurn: false,
      workspaceNotes: [],
    },
    setup: createAttemptSetupFixture({
      effectiveCwd: attempt.workspaceDir,
      effectiveWorkspace: attempt.workspaceDir,
      resolvedWorkspace: attempt.workspaceDir,
      sessionPermissionRoot: attempt.workspaceDir,
      getProviderRuntimeHandle: () => ({
        provider: attempt.provider,
        modelId: attempt.modelId,
        workspaceDir: attempt.workspaceDir,
        prepared: true,
      }),
    }),
    capabilityToolNames: new Set<string>(),
    effectiveTools: [],
    isRawModelRun: false,
    modelToolsEnabled: true,
    skillsPrompt: "",
    toolSearchDirectoryEnabled: false,
    toolSearchRuntimeConfig: attempt.config,
  } satisfies Parameters<typeof prepareEmbeddedAttemptSystemPrompt>[0];
}

async function fixture() {
  const prefix = path.join(
    "Codex-session-files",
    "branch-feature-third-20261003",
    "memory",
    "prompt-",
  );
  await fs.mkdir(path.dirname(path.join(os.tmpdir(), prefix)), { recursive: true });
  state = await createBranchTestState({ label: "external-rules-prompt", prefix });
  await fs.mkdir(path.join(state.workspaceDir, ".cursor/rules"), { recursive: true });
  await fs.writeFile(path.join(state.workspaceDir, ".cursorrules"), "CURSOR_LEGACY");
  await fs.writeFile(path.join(state.workspaceDir, ".cursor/rules/a.mdc"), "CURSOR_DIRECTORY");
  await fs.writeFile(path.join(state.workspaceDir, ".windsurfrules"), "WINDSURF_RULE");
  const config = {
    agents: {
      ownership: "explicit" as const,
      entries: { main: { workspace: state.workspaceDir, agentDir: state.agentDir() } },
    },
  };
  const admission = prepareSystemAgentRunAdmission(
    config,
    "external-rules",
    "main",
    "external-rules-test",
  );
  close.push(() => admission.close());
  const attempt = attemptFor(state, await admission.admit("embedded"));
  return {
    params: parameters(attempt),
    scope: { agentDir: state.agentDir(), workspace: state.workspaceDir },
  };
}

function response(model: EmbeddedRunAttemptParams["model"]): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: "text", text: "Fixture response" }],
    stopReason: "stop",
    timestamp: 1,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

async function providerSession(params: ReturnType<typeof parameters>, requests: string[]) {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(params.attempt.provider, "fixture-not-a-secret");
  const modelRegistry = ModelRegistry.inMemory(authStorage);
  modelRegistry.registerProvider(params.attempt.provider, {
    api: params.attempt.model.api,
    streamSimple(model, context: Context) {
      requests.push(context.systemPrompt ?? "");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "done", reason: "stop", message: response(model) });
        stream.end();
      });
      return stream;
    },
  });
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: params.setup.effectiveCwd,
    agentDir: params.attempt.agentDir!,
  });
  await resourceLoader.reload();
  // The prepared prompt is installed per turn below, as the embedded runner does.
  const result = await createAgentSession({
    systemPrompt: "",
    cwd: params.setup.effectiveCwd,
    tools: [],
    model: params.attempt.model,
    thinkingLevel: "off",
    modelRegistry,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });
  close.push(() => result.session.dispose());
  return result.session;
}

it("delivers fresh real rule state through actual prompt preparation and the provider boundary", async () => {
  const { params, scope } = await fixture();
  const requests: string[] = [];
  const session = await providerSession(params, requests);
  const first = await prepareEmbeddedAttemptSystemPrompt(params);
  session.setBaseSystemPrompt(first.systemPromptText.trim());
  await session.prompt("First real fixture turn");
  expect(requests[0]).toContain("CURSOR_LEGACY");
  expect(requests[0]).toContain("CURSOR_DIRECTORY");
  expect(requests[0]).toContain("WINDSURF_RULE");
  expect(requests[0]).toContain("UNRELATED_SOUL");
  expect(requests[0]).toContain("UNRELATED_EXTRA");
  await toggleExternalProjectRule(scope, "cursor", ".cursorrules", false);
  const second = await prepareEmbeddedAttemptSystemPrompt(params);
  session.setBaseSystemPrompt(second.systemPromptText.trim());
  await session.prompt("Next real fixture turn");
  expect(requests[1]).not.toContain("CURSOR_LEGACY");
  expect(requests[1]).toContain("CURSOR_DIRECTORY");
  expect(requests[1]).toContain("WINDSURF_RULE");
  await toggleExternalProjectRule(scope, "windsurf", ".windsurfrules", false);
  await toggleExternalProjectRule(scope, "cursor", ".cursorrules", true);
  const third = await prepareEmbeddedAttemptSystemPrompt(params);
  session.setBaseSystemPrompt(third.systemPromptText.trim());
  await session.prompt("Enabled again");
  expect(requests[2]).toContain("CURSOR_LEGACY");
  expect(requests[2]).not.toContain("WINDSURF_RULE");
});

it("rereads changed bodies, scopes valid frontmatter and preserves malformed raw rules", async () => {
  const { params, scope } = await fixture();
  await fs.writeFile(
    path.join(scope.workspace, ".cursorrules"),
    "---\npaths: [docs/**]\n---\nDOCS_ONLY",
  );
  expect((await prepareEmbeddedAttemptSystemPrompt(params)).systemPromptText).not.toContain(
    "DOCS_ONLY",
  );
  params.attempt.prompt = "Edit docs/readme.md";
  expect((await prepareEmbeddedAttemptSystemPrompt(params)).systemPromptText).toContain(
    "DOCS_ONLY",
  );
  await fs.writeFile(
    path.join(scope.workspace, ".cursorrules"),
    "---\npaths: *\n---\nMALFORMED_REVISION",
  );
  expect((await prepareEmbeddedAttemptSystemPrompt(params)).systemPromptText).toContain(
    "---\npaths: *\n---\nMALFORMED_REVISION",
  );
});

it("suppresses external filesystem/state discovery in raw probes and settled finalization", async () => {
  const { params, scope } = await fixture();
  const release = registerAgentWorkspaceAccess(scope.workspace, {
    bridge: {
      readFile: async () => {
        throw new Error("UNEXPECTED_EXTERNAL_IO");
      },
      stat: async () => {
        throw new Error("UNEXPECTED_EXTERNAL_IO");
      },
      writeFile: async () => {
        throw new Error("UNEXPECTED_EXTERNAL_IO");
      },
    },
  });
  close.push(release);
  params.isRawModelRun = true;
  expect((await prepareEmbeddedAttemptSystemPrompt(params)).systemPromptText).toBe("");
  params.isRawModelRun = false;
  params.attempt.operation = "settled-tool-finalization";
  expect((await prepareEmbeddedAttemptSystemPrompt(params)).systemPromptText).toBe("");
  await expect(fs.stat(path.join(scope.agentDir, "rule-toggles"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

async function guardedBridge(remote: string) {
  const root = await fsRoot(remote);
  return {
    async stat({ filePath }: { filePath: string }) {
      try {
        const stat = await root.stat(filePath);
        return {
          type: stat.isDirectory ? ("directory" as const) : ("file" as const),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      } catch (error) {
        if (isMissingExternalRule(error)) return null;
        throw error;
      }
    },
    readDirectory: ({ filePath }: { filePath: string }) =>
      root.list(filePath, { withFileTypes: true }),
    readFile: async ({ filePath }: { filePath: string }) =>
      (await root.read(filePath, { maxBytes: Infinity })).buffer,
    async readFileWithSource({ filePath }: { filePath: string }) {
      const opened = await root.open(filePath, { symlinks: "follow-within-root" });
      try {
        return {
          data: await opened.handle.readFile(),
          canonicalPath: opened.realPath,
          workspaceRelativePath: path
            .relative(root.rootReal, opened.realPath)
            .split(path.sep)
            .join("/"),
        };
      } finally {
        await opened.handle.close();
      }
    },
    writeFile: async () => {
      throw new Error("read-only fixture bridge");
    },
  };
}

it("uses the registered physical bridge for the selected logical workspace without host fallback", async () => {
  const { params, scope } = await fixture();
  const remote = state!.path("execution-root");
  await fs.mkdir(remote);
  await fs.writeFile(path.join(remote, ".cursorrules"), "EXECUTION_HOST_RULE");
  const release = registerAgentWorkspaceAccess(scope.workspace, {
    bridge: await guardedBridge(remote),
  });
  close.push(release);
  const prepared = await prepareEmbeddedAttemptSystemPrompt(params);
  expect(prepared.systemPromptText).toContain("EXECUTION_HOST_RULE");
  expect(prepared.systemPromptText).not.toContain("CURSOR_LEGACY");
  expect(prepared.systemPromptText).not.toContain("CURSOR_DIRECTORY");
});
