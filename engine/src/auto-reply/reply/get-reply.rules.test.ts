// Real inbound dispatch, real durable state; no mocked embedded runner counts as prompt proof.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readExternalRuleState } from "../../agents/external-project-rules.state.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { withPluginRuntimeRegistryScope } from "../../plugins/runtime/gateway-request-scope.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { withFullRuntimeReplyConfig } from "./get-reply-fast-path.js";
import { getReplyFromConfig } from "./get-reply.js";
import { finalizeInboundContext } from "./inbound-context.js";

let state: BranchTestState | undefined;
afterEach(async () => {
  await state?.cleanup();
  state = undefined;
});
const sessionKey = "agent:main:rules-native-fixture";

async function fixture() {
  await fs.mkdir(
    path.join(os.tmpdir(), "Codex-session-files", "branch-feature-third-20261003", "memory"),
    { recursive: true },
  );
  state = await createBranchTestState({
    label: "rules-inbound",
    env: { BRANCH_TEST_FAST: "0" },
    prefix: path.join("Codex-session-files", "branch-feature-third-20261003", "memory", "reply-"),
  });
  await fs.mkdir(state.workspaceDir, { recursive: true });
  await fs.writeFile(path.join(state.workspaceDir, ".cursorrules"), "Cursor fixture");
  await fs.writeFile(path.join(state.workspaceDir, ".windsurfrules"), "Windsurf fixture");
  const cfg = withFullRuntimeReplyConfig({
    agents: {
      ownership: "explicit",
      entries: { main: { workspace: state.workspaceDir, agentDir: state.agentDir() } },
      defaults: {
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
  return { cfg, scope: { workspace: state.workspaceDir, agentDir: state.agentDir() } };
}

function invoke(
  cfg: ReturnType<typeof withFullRuntimeReplyConfig>,
  source: "native" | "text",
  body: string,
  authorized = true,
  scopes = ["operator.admin"],
) {
  return withPluginRuntimeRegistryScope(createEmptyPluginRegistry(), () =>
    getReplyFromConfig(
      finalizeInboundContext({
        Body: body,
        RawBody: body,
        BodyForAgent: body,
        CommandBody: body,
        CommandSource: source,
        CommandAuthorized: authorized,
        Provider: INTERNAL_MESSAGE_CHANNEL,
        Surface: INTERNAL_MESSAGE_CHANNEL,
        ChatType: "direct",
        SessionKey: sessionKey,
        GatewayClientScopes: scopes,
        ...(source === "native" ? { CommandTargetSessionKey: sessionKey } : {}),
      }),
      undefined,
      cfg,
    ),
  );
}

it.each(["native", "text"] as const)(
  "persists through actual %s inbound routing once",
  async (source) => {
    const { cfg, scope } = await fixture();
    const reply = await invoke(cfg, source, "/rules cursor off .cursorrules");
    expect([reply].flat()).toEqual([
      expect.objectContaining({ text: expect.stringContaining(".cursorrules: off") }),
    ]);
    expect(await readExternalRuleState(scope)).toEqual({
      cursor: { ".cursorrules": false },
      windsurf: { ".windsurfrules": true },
    });
    const listing = await invoke(cfg, source, "/rules");
    expect([listing].flat()).toEqual([
      expect.objectContaining({ text: expect.stringContaining("cursor: off .cursorrules") }),
    ]);
  },
);

it("denies an unauthorized native sender and a non-admin settings caller without state writes", async () => {
  const { cfg, scope } = await fixture();
  expect([await invoke(cfg, "native", "/rules cursor off .cursorrules", false)].flat()).toEqual([
    expect.objectContaining({ text: expect.stringContaining("not authorized") }),
  ]);
  await invoke(cfg, "native", "/rules cursor off .cursorrules", true, ["operator.write"]);
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
});

it("native routing uses persisted spawned workspace selection", async () => {
  const { cfg, scope } = await fixture();
  const child = state!.path("child-workspace");
  await fs.mkdir(child);
  await fs.writeFile(path.join(child, ".windsurfrules"), "Selected child");
  await replaceSessionEntry(
    { agentId: "main", sessionKey },
    {
      sessionId: "rules-child",
      updatedAt: 1,
      spawnedBy: "agent:main:parent",
      spawnedWorkspaceDir: child,
    },
  );
  await invoke(cfg, "native", "/rules windsurf off .windsurfrules");
  expect(
    (await readExternalRuleState({ ...scope, workspace: child })).windsurf[".windsurfrules"],
  ).toBe(false);
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
});
