import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onTrustedInternalDiagnosticEvent } from "../../infra/diagnostic-events.js";
import { prepareSkillCommandsForWorkspace } from "../../skills/discovery/chat-commands.js";
import { consumeRunSkillUsage } from "../../skills/runtime/run-usage.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { handleInlineActions } from "./get-reply-inline-actions.js";
import {
  createHandleInlineActionsInput,
  createTypingController,
} from "./get-reply-inline-actions.test-support.js";
import { buildTestCtx } from "./test-ctx.js";

const commands = vi.hoisted(() => vi.fn(async () => ({ shouldContinue: true })));
vi.mock("./commands.runtime.js", () => ({ handleCommands: commands, buildStatusReply: vi.fn() }));

let root: string;
let workspace: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-bundle-inline-"));
  workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(root, "skill-bundles"));
  vi.stubEnv("BRANCH_STATE_DIR", root);
  vi.stubEnv("BRANCH_HOME", root);
  commands.mockClear();
  for (const name of ["alpha", "beta", "combo"]) {
    const folder = path.join(workspace, "skills", name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "SKILL.md"),
      `---\nname: ${name}\ndescription: member ${name}\n---\n\nBODY ${name}`,
    );
  }
  fs.writeFileSync(
    path.join(root, "skill-bundles", "combo.yaml"),
    "name: combo\nskills: [alpha, beta]\ninstruction: bundle $ARGUMENTS\n",
  );
});
afterEach(async () => {
  await cleanupSessionStateForTest({ stateDir: root, rootPath: root });
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  vi.unstubAllEnvs();
});
async function run(body: string, authorized = true, allowTextCommands = true) {
  const ctx = buildTestCtx({ Body: body, CommandBody: body, RawBody: body });
  const sessionCtx = { ...ctx };
  const input = createHandleInlineActionsInput({
    ctx,
    typing: createTypingController(),
    cleanedBody: body,
    command: { isAuthorizedSender: authorized },
    overrides: {
      cfg: { commands: { text: true } },
      workspaceDir: workspace,
      allowTextCommands,
      opts: { runId: `bundle-${path.basename(root)}` },
    },
  });
  const result = await handleInlineActions({ ...input, sessionCtx });
  return { result, ctx, sessionCtx };
}

describe("actual handleInlineActions YAML bundle invocation", () => {
  it("executes a complete Unicode source slug through underscore-normalized typed invocation", async () => {
    const name = `小说-${"long-bundle-".repeat(6)}name`;
    fs.writeFileSync(
      path.join(root, "skill-bundles", "combo.yaml"),
      `name: ${name}\nskills: [alpha, beta]\n`,
    );
    const { result } = await run(`/${name.replaceAll("-", "_")} literal request`);
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.cleanedBody).toContain(`Bundle: ${name}`);
      expect(result.cleanedBody).toContain("BODY alpha");
      expect(result.cleanedBody).toContain("User instruction: literal request");
    }
  });
  it.each(["/combo user $ARGUMENTS", "/skill combo user $ARGUMENTS"])(
    "embeds whole authorized members and selections through %s",
    async (body) => {
      const { result, ctx, sessionCtx } = await run(body);
      expect(result.kind).toBe("continue");
      if (result.kind !== "continue") {
        throw new Error("Bundle did not continue to model");
      }
      expect(result.cleanedBody).toContain("BODY alpha");
      expect(result.cleanedBody).toContain("BODY beta");
      expect(result.cleanedBody).not.toContain("BODY combo");
      expect(result.cleanedBody).toContain("bundle $ARGUMENTS");
      expect(result.cleanedBody).toContain("User instruction: user $ARGUMENTS");
      expect(ctx.Body).toBe(result.cleanedBody);
      expect(ctx.BodyForAgent).toBe(result.cleanedBody);
      expect(sessionCtx.Body).toBe(result.cleanedBody);
      expect(sessionCtx.agentText).toBe(result.cleanedBody);
      expect(ctx.RawBody).toBe(body);
      expect(ctx.CommandBody).toBe(body);
      expect(result.explicitSkillSelections?.map((selection) => selection.name)).toEqual([
        "alpha",
        "beta",
      ]);
      expect(commands).not.toHaveBeenCalled();
      expect(
        consumeRunSkillUsage(`bundle-${path.basename(root)}`).map((usage) => ({
          name: usage.name,
          activation: usage.activation,
        })),
      ).toEqual([
        { name: "alpha", activation: "command" },
        { name: "beta", activation: "command" },
      ]);
    },
  );
  it("rechecks member permissions when caller supplies a stale native menu", async () => {
    const skillCommands = await prepareSkillCommandsForWorkspace({
      workspaceDir: workspace,
      cfg: {},
    });
    const ctx = buildTestCtx({ Body: "/combo request", CommandBody: "/combo request" });
    const input = createHandleInlineActionsInput({
      ctx,
      typing: createTypingController(),
      cleanedBody: "/combo request",
      command: { isAuthorizedSender: true },
      overrides: {
        workspaceDir: workspace,
        skillCommands,
        allowTextCommands: true,
        cfg: { skills: { entries: { beta: { enabled: false } } } },
      },
    });
    const result = await handleInlineActions(input);
    expect(result.kind).toBe("continue");
    if (result.kind === "continue") {
      expect(result.cleanedBody).toContain("BODY alpha");
      expect(result.cleanedBody).not.toContain("BODY beta");
      expect(result.explicitSkillSelections?.map((selection) => selection.name)).toEqual(["alpha"]);
    }
  });
  it("uses admitted current overrides and trusted activation without inventing a run ID", async () => {
    const activations: Array<{ name: string; runId?: string; trusted: boolean }> = [];
    const release = onTrustedInternalDiagnosticEvent((event, metadata) => {
      if (event.type === "skill.used") {
        activations.push({
          name: event.skillName,
          runId: event.runId,
          trusted: metadata.trusted === true,
        });
      }
    });
    try {
      const body = "/combo request";
      const input = createHandleInlineActionsInput({
        ctx: buildTestCtx({ Body: body, CommandBody: body }),
        typing: createTypingController(),
        cleanedBody: body,
        command: { isAuthorizedSender: true },
        overrides: {
          workspaceDir: workspace,
          cfg: {},
          allowTextCommands: true,
          sessionEntry: {
            sessionId: "overlay-session",
            updatedAt: 1,
            skillsSnapshot: { prompt: "", skills: [], skillOverrides: { beta: true } },
          },
          opts: { skillOverrides: { beta: false } },
        },
      });
      const result = await handleInlineActions(input);
      expect(result.kind).toBe("continue");
      if (result.kind === "continue") {
        expect(result.cleanedBody).toContain("BODY alpha");
        expect(result.cleanedBody).not.toContain("BODY beta");
      }
      await vi.waitFor(() =>
        expect(activations).toEqual([{ name: "alpha", runId: undefined, trusted: true }]),
      );
    } finally {
      release();
    }
  });
  it.each([
    [false, true],
    [true, false],
  ])("does not read/rewrite bundle bodies for authorized=%s text=%s", async (authorized, text) => {
    const { ctx } = await run("/combo request", authorized, text);
    expect(ctx.Body).not.toContain("BODY alpha");
    expect(ctx.Body).toBe("/combo request");
  });
  it("returns a clear no-load reply when every current member is unavailable", async () => {
    fs.writeFileSync(
      path.join(root, "skill-bundles", "combo.yaml"),
      "name: combo\nskills: [missing]\n",
    );
    const { result, ctx } = await run("/combo request");
    expect(result.kind).toBe("reply");
    if (result.kind === "reply") {
      if (Array.isArray(result.reply)) {
        throw new Error("Expected one no-load reply");
      }
      expect(result.reply?.text).toContain("No eligible skill instructions");
    }
    expect(ctx.Body).toBe("/combo request");
  });
});
