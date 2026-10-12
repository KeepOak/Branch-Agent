import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readExternalRuleState } from "../../agents/external-project-rules.state.js";
import { handleRulesCommand } from "./commands-rules.js";
import { parseRulesCommand } from "./commands-rules.parse.js";
import type { HandleCommandsParams } from "./commands-types.js";
import { parseInlineSessionDirectives } from "./directive-handling.parse.js";

const directory = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "memory",
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.relative(directory, root).startsWith("command-"))
      throw new Error("Invalid fixture cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(body = "/rules") {
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.mkdtemp(path.join(directory, "command-"));
  roots.push(root);
  const workspaceDir = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await fs.mkdir(workspaceDir);
  await fs.mkdir(agentDir);
  await fs.mkdir(path.join(workspaceDir, ".cursor/rules"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".cursor/rules/@scope rule.mdc"), "Cursor");
  await fs.writeFile(path.join(workspaceDir, ".windsurfrules"), "Windsurf");
  const params: HandleCommandsParams = {
    cfg: {},
    ctx: { Provider: "webchat", Surface: "webchat", CommandSource: "text" },
    command: {
      commandBodyNormalized: body,
      rawBodyNormalized: body,
      isAuthorizedSender: true,
      senderIsOwner: true,
      senderId: "fixture",
      channel: "webchat",
      surface: "webchat",
      ownerList: [],
    },
    agentId: "main",
    agentDir,
    workspaceDir,
    directives: parseInlineSessionDirectives(body),
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionKey: "agent:main:rules",
    provider: "openai",
    model: "gpt-5.6-luna",
    contextTokens: 0,
    isGroup: false,
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolveDefaultThinkingLevel: async () => undefined,
  };
  return { params, scope: { agentDir, workspace: workspaceDir } };
}

it("parses exact tokens and preserves literal @ plus spaces", () => {
  expect(parseRulesCommand("/rulesx")).toBeNull();
  expect(parseRulesCommand("/rules")).toEqual({ action: "list" });
  expect(parseRulesCommand("/rules cursor off .cursor/rules/@scope rule.mdc")).toEqual({
    action: "toggle",
    provider: "cursor",
    enabled: false,
    path: ".cursor/rules/@scope rule.mdc",
  });
  expect(parseRulesCommand("/rules cursor maybe a.mdc")?.action).toBe("error");
});

it("lists real rule inventory without mutating state, then writes the selected provider", async () => {
  const { params, scope } = await fixture();
  expect((await handleRulesCommand(params, true))?.reply?.text).toContain(
    "cursor: on .cursor/rules/@scope rule.mdc",
  );
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
  params.command.commandBodyNormalized = "/rules cursor off .cursor/rules/@scope rule.mdc";
  expect((await handleRulesCommand(params, true))?.reply?.text).toContain(": off");
  expect((await readExternalRuleState(scope)).windsurf).toEqual({ ".windsurfrules": true });
  expect((await readExternalRuleState(scope)).cursor[".cursor/rules/@scope rule.mdc"]).toBe(false);
});

it.each(["unauthorized", "nonowner", "scope", "revoked"])("refuses %s mutation", async (reason) => {
  const { params, scope } = await fixture("/rules windsurf off .windsurfrules");
  if (reason === "unauthorized") params.command.isAuthorizedSender = false;
  if (reason === "nonowner") params.command.senderIsOwner = false;
  if (reason === "scope") params.ctx.GatewayClientScopes = ["operator.write"];
  if (reason === "revoked")
    params.command.assertOwnerCurrent = () => {
      throw new Error("revoked");
    };
  expect((await handleRulesCommand(params, true))?.shouldContinue).toBe(false);
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
});

it("rejects an unavailable path and an existing rule of the wrong provider", async () => {
  const { params, scope } = await fixture("/rules cursor off .windsurfrules");
  expect((await handleRulesCommand(params, true))?.reply?.text).toContain(
    "not an available cursor rule",
  );
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
  params.command.commandBodyNormalized = "/rules cursor off ../outside.mdc";
  expect((await handleRulesCommand(params, true))?.reply?.text).toContain(
    "not an available cursor rule",
  );
});

it("uses selected spawned workspace rather than the configured root", async () => {
  const { params, scope } = await fixture("/rules windsurf off .windsurfrules");
  const workspace = path.join(params.workspaceDir, "child");
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, ".windsurfrules"), "Child only");
  params.sessionEntry = {
    sessionId: "child",
    updatedAt: 1,
    spawnedBy: "agent:main:parent",
    spawnedWorkspaceDir: workspace,
  };
  await handleRulesCommand(params, true);
  expect((await readExternalRuleState({ ...scope, workspace })).windsurf[".windsurfrules"]).toBe(
    false,
  );
  expect(await readExternalRuleState(scope)).toEqual({ cursor: {}, windsurf: {} });
});
