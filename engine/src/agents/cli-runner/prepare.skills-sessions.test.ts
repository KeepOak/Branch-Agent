// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { makeUserMessage } from "../../../test/helpers/user-message.js";
import { runWithCliHistoryWriter } from "../../config/sessions/cli-history-boundary.js";
import {
  loadSessionEntryReadOnly,
  loadTranscriptEventsSync,
  patchSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type { ContextEngine } from "../../context-engine/types.js";
import type {
  CliBackendExecuteContext,
  CliBackendPlugin,
} from "../../plugins/cli-backend.types.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { setActiveDegradedSecretOwners } from "../../secrets/runtime-degraded-state.js";
import { buildSkillSnapshot } from "../../skills/loading/workspace-skill-prompt.js";
import type { SkillSnapshot } from "../../skills/types.js";
import {
  createOperationalRunInstanceRef,
  prepareAgentRunAdmission,
  prepareSystemAgentRunAdmission,
} from "../admitted-run-context.js";
import {
  withTestRunAdmission,
  wrapRunWithTestPreparedAdmission,
} from "../admitted-run-context.test-support.js";
import { saveAuthProfileStore } from "../auth-profiles/store-runtime.js";
import { CLI_AUTH_EPOCH_VERSION, resolveCliAuthEpoch } from "../cli-auth-epoch.js";
import {
  createCliRunnerPrepareFixture,
  createWeatherSkillFixture,
  buildDefaultTestCliBackend,
} from "../cli-runner.test-helpers.js";
import { hashCliSessionText } from "../cli-session.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import { SessionManager } from "../sessions/session-manager.js";
import { createZeroUsageFixture } from "../test-helpers/usage-fixtures.js";
import { prepareClaudeCliSkillsPlugin } from "./claude-skills-plugin.js";
import { prepareCliHistoryBoundary } from "./history-boundary.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  createLoopbackRuntime,
  installTestPluginRegistry,
  registerTestContextEngine,
  setCliBackendForPrepareTest,
  installCliRunnerPrepareTestDoubles,
  resetCliRunnerPrepareTestDoubles,
} from "./prepare.shared.test-support.js";
import { setCliRunnerPrepareTestDeps } from "./prepare.test-support.js";

const getRuntimeConfigMock = vi.hoisted(() => vi.fn(() => ({})));
const ensureSandboxWorkspaceForSessionMock = vi.hoisted(() =>
  vi.fn<() => Promise<SandboxWorkspaceInfo | null>>(async () => null),
);
// mock-isolation: Preparation reads a per-case runtime config instead of host Branch config.
vi.mock("../../config/config.js", async () => ({
  getRuntimeConfig: getRuntimeConfigMock,
  resolveGatewayPort: (await import("../../config/paths.js")).resolveGatewayPort,
}));

// mock-isolation: Sandbox workspace setup is a per-case double; preparation only consumes its result.
vi.mock("../sandbox.js", () => ({
  ensureSandboxWorkspaceForSession: ensureSandboxWorkspaceForSessionMock,
}));

// mock-isolation: Prompt-build hooks are injected per case through the global hook runner seam.
vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

// mock-isolation: TTS prompt hints stay inert so preparation never reads host speech preferences.
vi.mock("../../tts/tts-settings.js", () => ({
  buildTtsSystemPromptHint: vi.fn(() => undefined),
  resolveModelOverridePolicy: vi.fn(),
  setTtsMachinePrefsPathResolver: vi.fn(),
}));

// mock-isolation: Media task context is injected per case without the shared task registry.
vi.mock("../media-generation-task-status.js", () => ({
  buildMediaTaskRuntimeContext: vi.fn(() => undefined),
  VIDEO_GENERATION_TASK_KIND: "video_generation",
  buildVideoGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildVideoGenerationTaskStatusText: vi.fn(() => ""),
  findActiveVideoGenerationTaskForSession: vi.fn(() => undefined),
  IMAGE_GENERATION_TASK_KIND: "image_generation",
  buildImageGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildImageGenerationTaskStatusText: vi.fn(() => ""),
  MUSIC_GENERATION_TASK_KIND: "music_generation",
  buildMusicGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildMusicGenerationTaskStatusText: vi.fn(() => ""),
  findActiveMusicGenerationTaskForSession: vi.fn(() => undefined),
}));

const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);

describe("prepareCliRunContext", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;

  async function withAuthenticatedHistory(
    provider: string,
    run: (
      prepare: (
        overrides: NonNullable<Parameters<typeof fixture.prepare>[0]>,
      ) => ReturnType<typeof fixture.prepare>,
    ) => Promise<void>,
  ) {
    const { dir, sessionTarget } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "history-test:account";
    const credential = {
      type: "token" as const,
      provider: provider === "claude-cli" ? "anthropic" : provider,
      token: "synthetic-history-account",
    };
    saveAuthProfileStore({ version: 1, profiles: { [authProfileId]: credential } }, agentDir);
    const authEpoch = await resolveCliAuthEpoch({ provider, agentDir, authProfileId });
    const runId = "authenticated-history-fixture";
    await patchSessionEntryCore(sessionTarget, (entry) => ({ ...entry, activeWriterRunId: runId }));
    const admission = prepareSystemAgentRunAdmission({}, runId, "main", "history-fixture");
    try {
      const admittedRunContext = await admission.admit("embedded");
      const writer = await prepareCliHistoryBoundary(
        {
          admittedRunContext,
          runId,
          agentDir,
          provider,
          model: "test-model",
          prompt: "seed",
          workspaceDir: dir,
          timeoutMs: 1000,
          sessionId: sessionTarget.sessionId,
          sessionKey: sessionTarget.sessionKey,
          sessionFile: sessionTarget.sessionKey,
          sessionTarget,
        },
        { credential },
      );
      expect(writer).toBeDefined();
      await runWithCliHistoryWriter(writer, () =>
        run((overrides) =>
          fixture.prepare({
            ...overrides,
            provider,
            agentDir,
            authProfileId,
            runId,
            preparedRunAdmission: admission,
            sessionKey: sessionTarget.sessionKey,
            ...(overrides.cliSessionBinding
              ? {
                  cliSessionBinding: {
                    ...overrides.cliSessionBinding,
                    authProfileId,
                    authEpoch,
                    authEpochVersion: CLI_AUTH_EPOCH_VERSION,
                  },
                }
              : {}),
          }),
        ),
      );
    } finally {
      admission.close();
    }
  }

  beforeEach(() => {
    installCliRunnerPrepareTestDoubles();
    // Discovery cases explicitly opt out of the prepared empty catalog.
    fixture = createCliRunnerPrepareFixture((params) =>
      prepareCliRunContext({ skillsSnapshot: { prompt: "", skills: [] }, ...params }),
    );
  });

  afterEach(async () => {
    await fixture.settle();
    resetCliRunnerPrepareTestDoubles();
    await fixture.cleanup();
  });

  it("keeps a warm claude-cli binding when its managed stdio child is still live", async () => {
    await withAuthenticatedHistory("claude-cli", async (prepare) => {
      const { dir } = fixture.session;
      fixture.appendTranscript({
        id: "msg-warm-1",
        parentId: null,
        timestamp: new Date(1).toISOString(),
        message: makeUserMessage("earlier warm context", 1),
      });
      setCliBackendForPrepareTest({
        liveSession: true,
        reseedFromRawTranscriptWhenUncompacted: true,
      });
      const transcriptCheck = vi.fn(async () => false);
      const orphanCheck = vi.fn(async () => true);
      const getLiveSessionGeneration = vi.fn(() => "warm-live-generation");
      setCliRunnerPrepareTestDeps({
        claudeCliSessionTranscriptHasContent: transcriptCheck,
        claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
        getCliLiveSessionGeneration: getLiveSessionGeneration,
      });

      const context = await prepare({
        sessionKey: "agent:main:telegram:direct:peer",
        prompt: "warm follow-up",
        provider: "claude-cli",
        model: "opus",
        cliSessionBinding: { sessionId: "warm-claude-sid" },
        cliSessionId: "warm-claude-sid",
      });

      expect(getLiveSessionGeneration).toHaveBeenCalledWith({
        backendId: "claude-cli",
        agentAccountId: undefined,
        agentId: "main",
        authProfileId: "history-test:account",
        sessionId: "session-test",
        sessionKey: "agent:main:main",
      });
      expect(transcriptCheck).toHaveBeenCalledWith({
        sessionId: "warm-claude-sid",
        workspaceDir: dir,
      });
      expect(orphanCheck).not.toHaveBeenCalled();
      expect(context.reusableCliSession).toEqual({
        mode: "reuse",
        sessionId: "warm-claude-sid",
      });
      expect(context.params.agentId).toBe("main");
      expect(context.requiredClaudeLiveSessionGeneration).toBe("warm-live-generation");
      expect(context.branchHistoryPrompt).toContain("earlier warm context");
      expect(context.branchHistoryPrompt).toContain("warm follow-up");
    });
  });

  it("ignores stored CLI session candidates when the backend disables sessions", async () => {
    setCliBackendForPrepareTest({
      sessionMode: "none",
      reseedFromRawTranscriptWhenUncompacted: true,
    });
    const transcriptCheck = vi.fn(async () => false);
    const orphanCheck = vi.fn(async () => false);
    setCliRunnerPrepareTestDeps({
      claudeCliSessionTranscriptHasContent: transcriptCheck,
      claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
    });

    const context = await fixture.prepare({
      sessionKey: "agent:main:telegram:direct:peer",
      prompt: "stateless ask",
      provider: "claude-cli",
      model: "opus",
      cliSessionBinding: { sessionId: "stale-claude-sid" },
      cliSessionId: "stale-claude-sid",
    });

    expect(context.reusableCliSession).toEqual({ mode: "none" });
    expect(transcriptCheck).not.toHaveBeenCalled();
    expect(orphanCheck).not.toHaveBeenCalled();
  });

  it.each(["prepared", "admitted"] as const)(
    "stops CLI skill preparation before sandbox materialization when %s authority is revoked",
    async (phase) => {
      const { dir } = fixture.session;
      const skillDir = path.join(dir, "skills", "awaited-probe");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        '---\nname: awaited-probe\ndescription: Probe before sandbox setup\nmetadata: {"branch":{"requires":{"bins":["cli-preparation-fixture-tool"]}}}\n---\n',
      );
      const started = createDeferred();
      const release = createDeferred();
      const originalAccess = fs.promises.access;
      const access = vi.spyOn(fs.promises, "access").mockImplementation(async (file, mode) => {
        if (String(file).includes("cli-preparation-fixture-tool")) {
          started.resolve();
          await release.promise;
          throw new Error("fixture executable is absent");
        }
        return originalAccess(file, mode);
      });
      const revoked = new Error("skill preparation source revoked");
      let current = true;
      const admission = prepareAgentRunAdmission({
        cfg: {},
        facts: {
          runId: "cli-skills-revocation",
          agentId: "main",
          ingress: { kind: "system", boundary: "skills-test", state: "present" },
        },
        operationalRunInstance: createOperationalRunInstanceRef("cli-skills-revocation"),
        assertSourceCurrent: () => {
          if (!current) {
            throw revoked;
          }
        },
      });
      try {
        const pending = fixture.prepare({
          runId: "cli-skills-revocation",
          skillsSnapshot: undefined,
          ...(phase === "prepared"
            ? { preparedRunAdmission: admission }
            : { admittedRunContext: await admission.admit("embedded") }),
          workspaceDir: dir,
          config: { plugins: { enabled: false }, skills: { load: { watch: false } } },
        });
        const rejected = expect(pending).rejects.toThrow(/revoked|authority/);
        await started.promise;
        current = false;
        release.resolve();
        await rejected;
        expect(ensureSandboxWorkspaceForSessionMock).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        admission.close();
        access.mockRestore();
      }
    },
  );

  it("renders sandbox-readable CLI skills for the explicit global-session owner", async () => {
    const sessionKey = "global";
    const { dir } = fixture.session;
    const hostSkillDir = "/home/tzdai/.npm-global/lib/node_modules/branch/skills/gog";
    const hostSkillPath = `${hostSkillDir}/SKILL.md`;
    const materializedWorkspace = path.join(dir, "state", "sandbox-skills");
    const materializedSkillDir = path.join(materializedWorkspace, "skills", "gog");
    const materializedSkillPath = path.join(materializedSkillDir, "SKILL.md");
    fs.mkdirSync(materializedSkillDir, { recursive: true });
    fs.writeFileSync(
      materializedSkillPath,
      [
        "---",
        "name: gog",
        "description: Read Gmail safely.",
        "---",
        "",
        "Use the Gmail tools before answering mail questions.",
      ].join("\n"),
      "utf-8",
    );
    ensureSandboxWorkspaceForSessionMock.mockResolvedValue({
      workspaceDir: dir,
      containerWorkdir: "/workspace",
      skillsWorkspaceDir: materializedWorkspace,
      workspaceAccess: "rw",
    });

    const config: BranchConfig = {
      agents: { ownership: "explicit", entries: { main: {}, worker: {} } },
    };
    const skillsSnapshot: SkillSnapshot = {
      prompt: [
        "<available_skills>",
        "  <skill>",
        "    <name>gog</name>",
        "    <description>Read Gmail safely.</description>",
        `    <location>${hostSkillPath}</location>`,
        "  </skill>",
        "</available_skills>",
      ].join("\n"),
      skills: [{ name: "gog" }],
      resolvedSkills: [
        {
          name: "gog",
          description: "Read Gmail safely.",
          filePath: hostSkillPath,
          baseDir: hostSkillDir,
          source: "branch-bundled",
          sourceInfo: {
            path: hostSkillPath,
            source: "branch-bundled",
            scope: "project",
            origin: "top-level",
            baseDir: hostSkillDir,
          },
          disableModelInvocation: false,
        },
      ],
    };
    const context = await fixture.prepare({
      config,
      sessionKey,
      agentId: "main",
      prompt: "are there any unread emails",
      skillsSnapshot,
    });

    expect(ensureSandboxWorkspaceForSessionMock).toHaveBeenCalledWith({
      config,
      agentId: "main",
      sessionKey,
      workspaceDir: dir,
      skillsSnapshot,
    });
    expect(context.systemPrompt).toContain("/workspace/.branch/sandbox-skills/skills/gog/SKILL.md");
    expect(context.systemPrompt).not.toContain(hostSkillPath);
    expect(context.systemPromptReport.skills.promptChars).toBeGreaterThan(0);
    expect(context.systemPromptReport.skills.entries).toEqual([
      { name: "gog", blockChars: expect.any(Number) },
    ]);
  });

  it("lazily rebuilds an unsafe modern skills snapshot for a non-sandbox CLI run", async () => {
    const { dir } = fixture.session;
    for (const name of ["cold-skill", "healthy-skill"]) {
      const skillDir = path.join(dir, "skills", name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name}\n---\n`,
        "utf-8",
      );
    }
    const snapshot = await buildSkillSnapshot(dir, {
      bundledSkillsDir: path.join(dir, "missing-bundled-skills"),
      managedSkillsDir: path.join(dir, "missing-managed-skills"),
    });
    setActiveDegradedSecretOwners([
      {
        ownerKind: "capability",
        ownerId: "skill:cold-skill",
        state: "unavailable",
        paths: ["skills.entries.cold-skill.apiKey"],
        refKeys: ["env:default:MISSING_SKILL_KEY"],
        reason: "secret provider failed",
      },
    ]);

    const context = await fixture.prepare({
      skillsSnapshot: {
        ...snapshot,
        prompt: `${snapshot.prompt}\n<available_skills></available_skills>`,
      },
    });

    // The prompt lists skill files with this OS's path separator.
    expect(context.systemPrompt).not.toContain(path.join("cold-skill", "SKILL.md"));
    expect(context.systemPrompt).toContain(path.join("healthy-skill", "SKILL.md"));
  });

  it("keeps prompt skills when native plugin materialization returns no args", async () => {
    const skill = createWeatherSkillFixture(fixture.session.dir, true);
    setCliBackendForPrepareTest({ id: "claude-cli", pluginId: "anthropic" });
    setCliRunnerPrepareTestDeps({
      prepareClaudeCliSkillsPlugin: vi.fn(async () => ({
        args: [],
        cleanup: vi.fn(async () => undefined),
      })),
    });
    const context = await fixture.prepare({
      provider: "claude-cli",
      model: "opus",
      skillsSnapshot: skill.snapshot,
    });
    expect(context.systemPrompt).toContain("<available_skills>");
    expect(context.systemPrompt).toContain("<name>weather</name>");
    expect(context.systemPromptReport.skills.promptChars).toBeGreaterThan(0);
    expect(context.claudeSkillsPluginArgs).toEqual([]);
    expect(context.preparedBackend.claimLiveSessionResources).toBeUndefined();
  });

  it("isolates claimed native skills from later turns while cleaning each turn's MCP and auth", async () => {
    const { dir } = fixture.session;
    const skill = createWeatherSkillFixture(dir, true);
    const preparedExecutionCleanup = vi.fn(async () => undefined);
    const revokeMcpLoopbackClientGrant = vi.fn(() => true);
    setCliBackendForPrepareTest({
      id: "claude-cli",
      pluginId: "anthropic",
      bundleMcp: true,
      prepareExecution: async () => ({ cleanup: preparedExecutionCleanup }),
    });
    setCliRunnerPrepareTestDeps({
      prepareClaudeCliSkillsPlugin,
      getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
      revokeMcpLoopbackClientGrant,
    });

    const context = await fixture.prepare({
      provider: "claude-cli",
      model: "opus",
      skillsSnapshot: skill.snapshot,
      sessionKey: "agent:main:main",
      runId: "native-skill-turn-one",
    });
    const pluginDir = context.claudeSkillsPluginArgs[1];
    if (!pluginDir) {
      throw new Error("Expected materialized skill plugin");
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginDir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ name: "branch-skills", skills: "./skills" });
    const skillPath = path.join(pluginDir, "skills", "weather", "SKILL.md");
    expect(fs.readFileSync(skillPath, "utf8")).toContain("Read forecast data before replying.");

    const releaseSkills = context.preparedBackend.claimLiveSessionResources?.();
    expect(releaseSkills).toEqual(expect.any(Function));
    expect(context.preparedBackend.claimLiveSessionResources?.()).toBeUndefined();
    try {
      await context.preparedBackend.cleanup?.();
      expect(fs.existsSync(skillPath)).toBe(true);
      expect(preparedExecutionCleanup).toHaveBeenCalledOnce();
      expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledExactlyOnceWith("loopback-token");

      const nextTurn = await fixture.prepare({
        provider: "claude-cli",
        model: "opus",
        skillsSnapshot: skill.snapshot,
        sessionKey: "agent:main:main",
        runId: "native-skill-turn-two",
      });
      const unusedPluginDir = nextTurn.claudeSkillsPluginArgs[1];
      expect(unusedPluginDir).toEqual(expect.any(String));
      expect(unusedPluginDir).not.toBe(pluginDir);
      expect(fs.existsSync(unusedPluginDir ?? "")).toBe(true);

      await nextTurn.preparedBackend.cleanup?.();
      expect(fs.existsSync(unusedPluginDir ?? "")).toBe(false);
      expect(fs.existsSync(skillPath)).toBe(true);
      expect(preparedExecutionCleanup).toHaveBeenCalledTimes(2);
      expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledTimes(2);
    } finally {
      await releaseSkills?.();
    }
    expect(fs.existsSync(pluginDir)).toBe(false);
  });

  it.for(["empty", "raw", "compacted", "blocked", "cancelled", "foreign-maintenance"] as const)(
    "isolates %s caller memory through outer normalization and real CLI execution",
    (scenario, { signal }) =>
      fixture.run(async () => {
        const { dir, sessionTarget: fixtureTarget } = fixture.session;
        const sessionTarget = fixtureTarget;
        const durable = SessionManager.open(fixtureTarget, dir);
        const retained = durable.appendMessage(makeUserMessage("BORROWED_RETAINED", 1));
        durable.appendCompaction("BORROWED_SUMMARY", retained, 1000);
        durable.appendMessage({ role: "user", content: "BORROWED_TAIL", timestamp: 2 });
        durable.flushPendingPersistence();
        const eventsBefore = loadTranscriptEventsSync(fixtureTarget);
        const entryBefore = loadSessionEntryReadOnly(fixtureTarget);
        const sessionManager = SessionManager.inMemory(dir);
        if (scenario === "raw" || scenario === "compacted") {
          const kept = sessionManager.appendMessage(makeUserMessage("OWNED_RETAINED", 1));
          if (scenario === "compacted") {
            sessionManager.appendCompaction("OWNED_SUMMARY", kept, 1000);
          }
          sessionManager.appendMessage({ role: "user", content: "OWNED_TAIL", timestamp: 2 });
        }
        const memoryBefore = structuredClone(sessionManager.getEntries());
        const outgoing: CliBackendExecuteContext[] = [];
        const cleanup = vi.fn(async () => undefined);
        const abortController = new AbortController();
        const backend: CliBackendPlugin = {
          ...buildDefaultTestCliBackend(),
          subscriptionAuthDispatch: true,
          nativeToolMode: "selectable",
          toolAvailabilityEnforcement: "execution-args",
          resolveExecutionArgs: ({ baseArgs }) => [...baseArgs],
          autoSelectAuthProfile: false,
          config: {
            command: process.execPath,
            args: [],
            resumeArgs: ["--resume", "{sessionId}"],
            output: "jsonl",
            input: "stdin",
            sessionMode: "existing",
            reseedFromRawTranscriptWhenUncompacted: true,
          },
          prepareExecution: async () => ({
            cleanup,
            async *execute(input) {
              outgoing.push(input);
              if (scenario === "cancelled") {
                abortController.abort();
                throw new Error("synthetic cancellation");
              }
              yield {
                type: "result",
                subtype: "success",
                result: "owned answer",
                session_id: "native-owned",
              };
            },
          }),
        };
        const builder = installTestPluginRegistry();
        builder.registry.cliBackends.push({ backend, pluginId: "test-cli-plugin", source: "test" });
        setRawCliBackendForPrepareTest({ ...backend, pluginId: "test-cli-plugin" });
        const engineId = `cli-memory-${scenario}`;
        const bootstrap = vi.fn<NonNullable<ContextEngine["bootstrap"]>>(async () => ({
          bootstrapped: true,
        }));
        const afterTurn = vi.fn<NonNullable<ContextEngine["afterTurn"]>>(async () => undefined);
        const maintain = vi.fn<NonNullable<ContextEngine["maintain"]>>(async () => ({
          changed: false,
          bytesFreed: 0,
          rewrittenEntries: 0,
        }));
        await registerTestContextEngine(engineId, () => ({
          info: { id: engineId, name: "Caller memory test" },
          ingest: async () => ({ ingested: true }),
          assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
          compact: async () => ({ ok: true, compacted: false }),
          bootstrap,
          afterTurn,
          maintain,
        }));
        signal.throwIfAborted();
        const runBeforePromptBuild = vi.fn(async (_event: { messages: unknown[] }) => undefined);
        const runBeforeAgentRun = vi.fn(async () =>
          scenario === "blocked"
            ? {
                decision: {
                  outcome: "block",
                  reason: "private synthetic reason",
                  message: "synthetic block",
                },
                pluginId: "owner-test",
              }
            : undefined,
        );
        mockGetGlobalHookRunner.mockReturnValue({
          hasHooks: (name: string) => name === "before_prompt_build" || name === "before_agent_run",
          runBeforePromptBuild,
          runBeforeAgentRun,
        } as never);
        const { runEmbeddedAgent: runEmbeddedAgentImpl } =
          await import("../embedded-agent-runner/run.js");
        signal.throwIfAborted();
        const runEmbeddedAgent = wrapRunWithTestPreparedAdmission(runEmbeddedAgentImpl);
        const runId = `memory-cli-${scenario}`;
        const maintenance = await import("../embedded-agent-runner/context-engine-maintenance.js");
        const releaseMaintenance = createDeferred();
        const maintenanceStarted = createDeferred();
        const borrowedWait = createDeferred();
        let maintenanceJoined: Promise<void> | undefined;
        let waitSpy:
          | MockInstance<typeof maintenance.waitForDeferredTurnMaintenanceForSession>
          | undefined;
        if (scenario === "foreign-maintenance") {
          await maintenance.runContextEngineMaintenance({
            contextEngine: {
              info: {
                id: "foreign-maintenance",
                name: "Foreign durable maintenance",
                turnMaintenanceMode: "background",
              },
              ingest: async () => ({ ingested: true }),
              assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
              compact: async () => ({ ok: true, compacted: false }),
              maintain: async () => {
                maintenanceStarted.resolve();
                await releaseMaintenance.promise;
                return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
              },
            },
            sessionId: fixtureTarget.sessionId,
            sessionKey: fixtureTarget.sessionKey,
            sessionTarget: fixtureTarget,
            sessionFile: fixtureTarget.sessionKey,
            reason: "turn",
            config: {},
            onDeferredMaintenance: (promise) => {
              maintenanceJoined = promise;
            },
          });
          await maintenanceStarted.promise;
          const wait = maintenance.waitForDeferredTurnMaintenanceForSession;
          waitSpy = vi
            .spyOn(maintenance, "waitForDeferredTurnMaintenanceForSession")
            .mockImplementation((key) => {
              borrowedWait.resolve();
              return wait(key);
            });
        }
        let run: ReturnType<typeof runEmbeddedAgent> | undefined;
        try {
          run = runEmbeddedAgent({
            sessionId: sessionTarget.sessionId,
            sessionKey: sessionTarget.sessionKey,
            sessionTarget: {
              ...sessionTarget,
              expectedLifecycleRevision: "borrowed-revision",
              expectedWriterRunId: "borrowed-writer",
            },
            sessionFile: sessionTarget.sessionKey,
            sessionManager,
            sessionPersistence: "detached",
            agentId: "main",
            workspaceDir: dir,
            config: { plugins: { slots: { contextEngine: engineId } } },
            prompt: "owned next ask",
            provider: "test-cli",
            model: "test-model",
            runId,
            timeoutMs: 1000,
            abortSignal: AbortSignal.any([abortController.signal, signal]),
            cliBackendDispatch: "subscription-auth",
            toolsAllow: ["read"],
          });
          if (scenario === "foreign-maintenance") {
            const outcome = await Promise.race([
              run.then(() => "completed"),
              borrowedWait.promise.then(() => "borrowed-wait"),
            ]);
            expect(outcome).toBe("completed");
            expect(waitSpy).not.toHaveBeenCalled();
          }
          if (scenario === "cancelled") {
            await expect(run).rejects.toThrow();
          } else {
            const result = await run;
            expect(result.payloads?.[0]?.text).toContain(
              scenario === "blocked" ? "synthetic block" : "owned answer",
            );
            expect(result.meta.agentMeta?.cliSessionBinding).toBeUndefined();
          }
          expect(cleanup).toHaveBeenCalledOnce();
          expect(runBeforePromptBuild).toHaveBeenCalledOnce();
          expect(JSON.stringify(runBeforePromptBuild.mock.calls)).not.toContain("BORROWED_");
          expect(loadTranscriptEventsSync(fixtureTarget)).toEqual(eventsBefore);
          expect(loadSessionEntryReadOnly(fixtureTarget)).toEqual(entryBefore);
          for (const input of [
            ...bootstrap.mock.calls.map(([event]) => event),
            ...afterTurn.mock.calls.map(([event]) => event),
            ...maintain.mock.calls.map(([event]) => event),
          ]) {
            expect(input.sessionTarget).toBeUndefined();
            expect(input.sessionFile).toBe(`in-memory:${sessionManager.getSessionId()}`);
            expect(input.runtimeContext?.sessionTarget).toBeUndefined();
          }
          if (scenario === "raw" || scenario === "compacted") {
            expect(bootstrap).toHaveBeenCalledOnce();
            const finalized = afterTurn.mock.calls[0]?.[0];
            expect(finalized?.prePromptMessageCount).toBe(scenario === "compacted" ? 3 : 2);
            expect(JSON.stringify(finalized?.messages)).toContain("OWNED_RETAINED");
            expect(JSON.stringify(finalized?.messages)).toContain("OWNED_TAIL");
            expect(JSON.stringify(finalized?.messages)).not.toContain("BORROWED_");
          } else {
            expect(bootstrap).not.toHaveBeenCalled();
          }
          if (scenario === "blocked") {
            expect(outgoing).toHaveLength(0);
            expect(JSON.stringify(sessionManager.getEntries())).toContain("synthetic block");
            expect(JSON.stringify(sessionManager.getEntries())).not.toContain(
              "private synthetic reason",
            );
          } else {
            expect(outgoing).toHaveLength(1);
            expect(outgoing[0]?.prompt).not.toContain("BORROWED_");
            expect(outgoing[0]?.useResume).toBe(false);
            expect(sessionManager.getEntries()).toEqual(memoryBefore);
            if (scenario === "raw" || scenario === "compacted") {
              expect(outgoing[0]?.prompt).toContain("OWNED_RETAINED");
              expect(outgoing[0]?.prompt).toContain("OWNED_TAIL");
              if (scenario === "compacted") {
                expect(outgoing[0]?.prompt).toContain("OWNED_SUMMARY");
              }
            } else {
              expect(outgoing[0]?.prompt).toBe("owned next ask");
            }
          }
          if (scenario === "raw") {
            // System-agent callers deliberately retain their own native binding beside memory.
            const context = await fixture.prepare({
              sessionManager,
              cliSessionBinding: { sessionId: "native-owned", cwdHash: hashCliSessionText(dir) },
            });
            expect(context.branchHistoryPrompt).toContain("OWNED_RETAINED");
            const { runPreparedCliAgent } = await import("../cli-runner.js");
            await withTestRunAdmission(context.params, (admittedRunContext) =>
              runPreparedCliAgent({
                ...context,
                params: { ...context.params, admittedRunContext },
              }),
            );
            expect(outgoing.at(-1)).toMatchObject({
              useResume: true,
              sessionId: "native-owned",
              prompt: "latest ask",
            });
            expect(sessionManager.getEntries()).toEqual(memoryBefore);
          }
        } finally {
          releaseMaintenance.resolve();
          await maintenanceJoined;
          await run?.catch(() => undefined);
          waitSpy?.mockRestore();
        }
      }),
  );

  it.each([
    {
      name: "uses the plan-safe Claude CLI cap before mapping canonical models to CLI aliases",
      provider: "claude-cli",
      model: "claude-opus-4-8",
      modelAliases: { "claude-opus-4-8": "opus" },
      marker: "RESEED_ALIAS_SUMMARY_MARKER_KEEP",
      padding: 40_000,
      expectsTruncation: false,
    },
    {
      name: "keeps the default reseed history cap for non-Claude CLI backends",
      provider: "test-cli",
      model: "test-model",
      marker: "RESEED_SUMMARY_MARKER_DEFAULT",
      padding: 20_000,
      expectsTruncation: true,
    },
  ])("$name", async (testCase) => {
    await withAuthenticatedHistory(testCase.provider, async (prepare) => {
      const { dir, sessionTarget } = fixture.session;
      if (testCase.provider === "claude-cli") {
        setCliBackendForPrepareTest({ modelAliases: testCase.modelAliases });
      }
      const manager = SessionManager.open(sessionTarget, dir);
      const firstKeptEntryId = manager.appendMessage(makeUserMessage("RESEED_RETAINED_PREFIX", 1));
      manager.appendCompaction(
        `${testCase.marker} ${"x".repeat(testCase.padding)}`,
        firstKeptEntryId,
        100_000,
      );
      manager.flushPendingPersistence();

      const context = await prepare({
        provider: testCase.provider,
        model: testCase.model,
      });

      expect(context.branchHistoryPrompt).toBeDefined();
      expect(context.branchHistoryPrompt).toContain("RESEED_RETAINED_PREFIX");
      if (testCase.expectsTruncation) {
        expect(context.branchHistoryPrompt).toContain("Branch Agent reseed history truncated");
      } else {
        expect(context.branchHistoryPrompt).toContain(testCase.marker);
        expect(context.branchHistoryPrompt).not.toContain("Branch Agent reseed history truncated");
      }
    });
  });

  it("uses the automatic Claude CLI cap through the raw-tail reseed path", async () => {
    await withAuthenticatedHistory("claude-cli", async (prepare) => {
      const { dir } = fixture.session;
      setRawCliBackendForPrepareTest({
        id: "claude-cli",
        pluginId: "anthropic",
        bundleMcp: false,
        config: {
          command: "claude",
          args: ["--print"],
          output: "jsonl",
          input: "stdin",
          sessionMode: "existing",
          reseedFromRawTranscriptWhenUncompacted: true,
        },
      });
      setCliRunnerPrepareTestDeps({
        claudeCliSessionTranscriptHasContent: vi.fn(async () => true),
      });
      const recentMarker = "RAW_RESEED_RECENT_MARKER_KEEP";
      const padding = "x".repeat(8_000);
      fixture.appendTranscript({
        id: "msg-1",
        parentId: null,
        timestamp: new Date(1).toISOString(),
        message: { role: "user", content: `EARLIEST_USER ${padding}`, timestamp: 1 },
      });
      fixture.appendTranscript({
        id: "msg-2",
        parentId: "msg-1",
        timestamp: new Date(2).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "text", text: `${recentMarker} ${padding}` }],
          api: "responses",
          provider: "test-cli",
          model: "test-model",
          usage: createZeroUsageFixture(),
          stopReason: "stop",
          timestamp: 2,
        },
      });

      const context = await prepare({
        provider: "claude-cli",
        model: "claude-haiku-3-5",
        cliSessionBinding: { sessionId: "cli-session", cwdHash: hashCliSessionText(dir) },
      });

      expect(context.reusableCliSession).toEqual({ mode: "reuse", sessionId: "cli-session" });
      expect(context.branchHistoryPrompt).toBeDefined();
      expect(context.branchHistoryPrompt).toContain(recentMarker);
      expect(context.branchHistoryPrompt).toContain("EARLIEST_USER");
      expect(context.branchHistoryPrompt).not.toContain("Branch Agent reseed history truncated");
    });
  });
});
