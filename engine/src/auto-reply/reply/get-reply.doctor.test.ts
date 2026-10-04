/** Actual inbound command pipeline to the primary runner; only the model runner is stubbed. */
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runEmbeddedAgent } from "../../agents/embedded-agent.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { withPluginRuntimeRegistryScope } from "../../plugins/runtime/gateway-request-scope.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { withFullRuntimeReplyConfig } from "./get-reply-fast-path.js";
import { getReplyFromConfig } from "./get-reply.js";
import { finalizeInboundContext } from "./inbound-context.js";

vi.mock("../../agents/embedded-agent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/embedded-agent.js")>()),
  runEmbeddedAgent: vi.fn(async () => ({
    payloads: [{ text: "Fixture investigation result" }],
    meta: { durationMs: 1 },
  })),
}));

let state: BranchTestState | undefined;
afterEach(async () => {
  await state?.cleanup();
  vi.clearAllMocks();
});

async function createInvestigationFixture() {
  const prefix = path.join(
    "Codex-session-files",
    "branch-feature-next-20261003",
    "observability",
    "reply-",
  );
  await fs.mkdir(path.dirname(path.join(tmpdir(), prefix)), { recursive: true });
  state = await createBranchTestState({
    label: "doctor-reply",
    prefix,
    env: { BRANCH_TEST_FAST: "0" },
  });
  const collision = path.join(state.workspaceDir, "skills", "context-doctor");
  await fs.mkdir(collision, { recursive: true });
  await fs.writeFile(
    path.join(collision, "SKILL.md"),
    "---\nname: context-doctor\ndescription: Fixture collision.\n---\nCollision instructions.\n",
  );
  const cfg = withFullRuntimeReplyConfig({
    agents: {
      defaults: {
        workspace: state.workspaceDir,
        skipBootstrap: true,
        model: { primary: "mock-openai/gpt-5.6-luna" },
        models: { "mock-openai/gpt-5.6-luna": { agentRuntime: { id: "branch" } } },
      },
    },
    plugins: { enabled: false },
    skills: { load: { watch: false } },
    commands: { text: true },
  });
  await state.writeConfig(cfg);
  return { cfg, workspaceDir: state.workspaceDir };
}

const sessionKey = "agent:main:doctor-investigation-fixture";
function invokeDoctor(
  source: "text" | "native",
  authorized: boolean,
  cfg: ReturnType<typeof withFullRuntimeReplyConfig>,
) {
  const body = "/doctor Investigate conversation-incident repeated tool failures";
  return withPluginRuntimeRegistryScope(createEmptyPluginRegistry(), () =>
    getReplyFromConfig(
      finalizeInboundContext({
        Body: body,
        RawBody: body,
        BodyForAgent: body,
        CommandBody: body,
        CommandSource: source,
        CommandAuthorized: authorized,
        Provider: "webchat",
        Surface: "webchat",
        ChatType: "direct",
        SessionKey: sessionKey,
        ...(source === "native" ? { CommandTargetSessionKey: sessionKey } : {}),
      }),
      undefined,
      cfg,
    ),
  );
}

async function awaitPrimaryTurn(run: () => ReturnType<typeof invokeDoctor>) {
  let finishTurn!: () => void;
  let markStarted!: () => void;
  const pendingTurn = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  vi.mocked(runEmbeddedAgent).mockImplementationOnce(async () => {
    markStarted();
    await pendingTurn;
    return { payloads: [{ text: "Fixture investigation result" }], meta: { durationMs: 1 } };
  });
  let settled = false;
  const running = run().then((reply) => {
    settled = true;
    return reply;
  });
  try {
    await Promise.race([started, running]);
    expect(runEmbeddedAgent).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
  } finally {
    finishTurn();
  }
  return running;
}

it.each([
  { source: "text", authorized: true },
  { source: "native", authorized: true },
  { source: "native", authorized: false },
] as const)(
  "routes /doctor through the actual $source pipeline with authorized=$authorized",
  async ({ source, authorized }) => {
    const { cfg, workspaceDir } = await createInvestigationFixture();
    const reply = authorized
      ? await awaitPrimaryTurn(() => invokeDoctor(source, authorized, cfg))
      : await invokeDoctor(source, authorized, cfg);
    if (!authorized) {
      expect([reply].flat()).toEqual([
        expect.objectContaining({ text: "You are not authorized to use this command." }),
      ]);
      expect(runEmbeddedAgent).not.toHaveBeenCalled();
      return;
    }
    expect([reply].flat()).toEqual([
      expect.objectContaining({ text: "Fixture investigation result" }),
    ]);
    expect(runEmbeddedAgent).toHaveBeenCalledOnce();
    const input = vi.mocked(runEmbeddedAgent).mock.calls[0]![0];
    expect(input.sessionKey).toBe(sessionKey);
    expect(input.explicitSkillSelections).toEqual([
      { name: "context_doctor", path: path.resolve("skills/context-doctor/SKILL.md") },
    ]);
    expect(input.prompt).toContain("primary investigator");
    expect(input.prompt).toContain("conversation-incident repeated tool failures");
    expect(input.prompt).toContain("Current agent ID: main");
    expect(input.prompt).toContain(workspaceDir);
  },
);
