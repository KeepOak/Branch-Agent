import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import { trunkTemplatesHandlers } from "./trunk-templates.js";

const { createMock, mutateMock, draft } = vi.hoisted(() => ({
  createMock: vi.fn(),
  mutateMock: vi.fn(),
  draft: { current: {} as Record<string, any> },
}));
vi.mock("./agents.js", () => ({ agentsHandlers: { "agents.create": createMock } }));
vi.mock("../../config/config.js", () => ({ mutateConfigFileWithRetry: mutateMock }));

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../../skills");
const EMPTY_CONFIG = { agents: { entries: {} } } as unknown as BranchConfig;

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "trunk-template-handler-"));
}

function call(
  method: "trunks.template.create" | "trunks.template.export",
  params: Record<string, unknown>,
  cfg: BranchConfig = EMPTY_CONFIG,
) {
  const respond = vi.fn();
  const options = {
    params,
    respond,
    context: { getRuntimeConfig: () => cfg },
  } as unknown as GatewayRequestHandlerOptions;
  return { respond, done: Promise.resolve(trunkTemplatesHandlers[method](options)) };
}

/** agents.create answers as the real handler does: agentId plus the workspace it created. */
function createAnswers(workspaceDir: string) {
  createMock.mockImplementation(async (options: { respond: (ok: boolean, payload?: unknown) => void }) => {
    options.respond(true, { ok: true, agentId: "newagent", workspace: workspaceDir });
  });
}

function templateFile(body: Record<string, unknown>, name = "custom.trunk-template.json"): string {
  const file = path.join(workspace(), name);
  writeFileSync(
    file,
    JSON.stringify({
      format: "branch.trunk-template",
      version: 1,
      name: "Custom",
      persona: { agentsMd: "# Custom\n" },
      skills: [],
      toolsets: {},
      permissions: ["This template sets no tool restrictions. Tool switches are set per Trunk after creating it."],
      ...body,
    }),
  );
  return file;
}

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

beforeEach(() => {
  createMock.mockReset();
  mutateMock.mockReset();
  mutateMock.mockImplementation(async (params: { mutate: (d: Record<string, any>) => void }) => {
    params.mutate(draft.current);
    return {};
  });
  draft.current = { agents: { defaults: {}, entries: {} } };
});

describe("trunks.template.create", () => {
  it("creates a Trunk from a bundled template, writes its persona where agents.create put it, and answers once", async () => {
    const dir = workspace();
    createAnswers(dir);
    const { respond, done } = call("trunks.template.create", { templateId: "researcher" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({ ok: true, agentId: "newagent", workspace: dir });
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("# Researcher");
  });

  it("uses the workspace from the agents.create answer, not from the config", async () => {
    const dir = workspace();
    createAnswers(dir);
    const { respond, done } = call("trunks.template.create", { templateId: "builder" }, EMPTY_CONFIG);
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
  });

  it("answers once with an error for an unknown template id, without creating a Trunk", async () => {
    const { respond, done } = call("trunks.template.create", { templateId: "no-such-template" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a relative template path with one error answer", async () => {
    const { respond, done } = call("trunks.template.create", { templatePath: "relative.trunk-template.json" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("requires the template suffix on a template path", async () => {
    const file = templateFile({}, "not-a-template.json");
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("refuses a template file over the size cap", async () => {
    const file = path.join(workspace(), "huge.trunk-template.json");
    writeFileSync(file, "x".repeat(257 * 1024));
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("answers with the create error once and writes no persona", async () => {
    const dir = workspace();
    createMock.mockImplementation(async (options: { respond: (ok: boolean, payload?: unknown, error?: unknown) => void }) => {
      options.respond(false, undefined, { code: "INVALID_REQUEST", message: "name taken" });
    });
    const { respond, done } = call("trunks.template.create", { templateId: "builder" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("answers once with an error when agents.create throws", async () => {
    createMock.mockRejectedValue(new Error("config write failed"));
    const { respond, done } = call("trunks.template.create", { templateId: "builder" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("answers once with an error when agents.create never answers", async () => {
    createMock.mockResolvedValue(undefined);
    const { respond, done } = call("trunks.template.create", { templateId: "builder" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("answers exactly once when the persona write fails after the Trunk is created", async () => {
    const blocker = path.join(workspace(), "not-a-directory");
    writeFileSync(blocker, "x");
    createAnswers(path.join(blocker, "trunk"));
    const { respond, done } = call("trunks.template.create", { templateId: "builder" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toContain("could not be applied");
  });

  it("reports skills, a model family and automations from a template as warnings, not failures", async () => {
    const dir = workspace();
    createAnswers(dir);
    const file = templateFile({
      skills: ["seedbank:@branch-agent/summarize-pdf"],
      model: { family: "gpt-5.5" },
      automations: [{ name: "Daily", cron: "0 8 * * *", prompt: "Summarize." }],
    });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    const payload = respond.mock.calls[0]?.[1] as { warnings: string[] };
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(payload.warnings).toEqual([
      expect.stringContaining("is not installed here"),
      expect.stringContaining("Model family"),
      expect.stringContaining("Automations in this template were not created"),
    ]);
  });
});

describe("trunks.template.create applies toolset switches and skills", () => {
  it("writes the template's toolset switches to the new Trunk's entry", async () => {
    createAnswers(workspace());
    const file = templateFile({ toolsets: { browser: false, files: true } });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(draft.current.agents.entries.newagent.toolsets).toEqual({ browser: false, files: true });
  });

  it("skips toolset names that are unknown or always on, with plain warnings", async () => {
    createAnswers(workspace());
    const file = templateFile({ toolsets: { nope: false, message: false, browser: true } });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(draft.current.agents.entries.newagent.toolsets).toEqual({ browser: true });
    const payload = respond.mock.calls[0]?.[1] as { warnings: string[] };
    expect(payload.warnings).toEqual([
      expect.stringContaining("names no known toolset"),
      expect.stringContaining("always on"),
    ]);
  });

  it("adds the template's skills to the shared skills filter when the defaults filter skills", async () => {
    draft.current.agents.defaults.skills = ["notes"];
    createAnswers(workspace());
    const file = templateFile({ skills: ["seedbank:@branch-agent/summarize-pdf"] });
    await call("trunks.template.create", { templatePath: file }).done;
    expect(draft.current.agents.entries.newagent.skills).toEqual(["notes", "summarize-pdf"]);
  });

  it("leaves the skills filter alone when the defaults do not filter skills", async () => {
    createAnswers(workspace());
    const file = templateFile({ skills: ["seedbank:@branch-agent/summarize-pdf"] });
    await call("trunks.template.create", { templatePath: file }).done;
    expect(draft.current.agents.entries.newagent.skills).toBeUndefined();
  });

  it("does not warn about a skill this engine ships", async () => {
    createAnswers(workspace());
    const file = templateFile({ skills: ["seedbank:@branch-agent/apple-notes"] });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    const payload = respond.mock.calls[0]?.[1] as { warnings: string[] };
    expect(payload.warnings.join("\n")).not.toContain("apple-notes");
  });

  it("answers once with an error naming the new agent and workspace when the settings write fails", async () => {
    const dir = workspace();
    createAnswers(dir);
    mutateMock.mockRejectedValue(new Error("config locked"));
    const file = templateFile({ toolsets: { browser: false } });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    const error = respond.mock.calls[0]?.[2] as { message: string; details?: unknown };
    expect(error.message).toContain("could not be applied");
    expect(error.message).toContain('agent "newagent"');
    expect(error.message).toContain(dir);
    expect(error.message).toContain("Do not run the create again");
    expect(error.details).toEqual({ agentId: "newagent", workspace: dir });
  });

  it("scrubs local user paths and secrets from the failure reason", async () => {
    createAnswers(workspace());
    mutateMock.mockRejectedValue(
      new Error("EACCES: open '/Users/taofikbishi/secret/config.json' token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"),
    );
    const file = templateFile({ toolsets: { browser: false } });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    const error = respond.mock.calls[0]?.[2] as { message: string };
    expect(error.message).toContain("EACCES");
    expect(error.message).not.toContain("/Users/taofikbishi");
    expect(error.message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});

describe("trunks.template.export", () => {
  it("answers once with an error for a Trunk that does not exist", async () => {
    const { respond, done } = call("trunks.template.export", { agentId: "ghost" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("refuses to export persona text that looks like a secret", async () => {
    const dir = workspace();
    writeFileSync(path.join(dir, "AGENTS.md"), "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz\n");
    const cfg = { agents: { entries: { ops: { name: "Ops", workspace: dir } } } } as unknown as BranchConfig;
    const { respond, done } = call("trunks.template.export", { agentId: "ops" }, cfg);
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls[0])).not.toContain("ghp_");
  });
});
