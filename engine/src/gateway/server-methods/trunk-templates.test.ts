import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { encodeTrunkTemplateLink } from "../../trunks/trunk-template-link.js";
import type { TrunkTemplate } from "../../trunks/trunk-template.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import { trunkTemplatesHandlers } from "./trunk-templates.js";

const { createMock, mutateMock, cronAddMock, cronListMock, draft } = vi.hoisted(() => ({
  createMock: vi.fn(),
  mutateMock: vi.fn(),
  cronAddMock: vi.fn(),
  cronListMock: vi.fn(),
  draft: { current: {} as Record<string, any> },
}));
vi.mock("./agents.js", () => ({ agentsHandlers: { "agents.create": createMock } }));
vi.mock("./cron.js", () => ({
  cronHandlers: { "cron.add": cronAddMock, "cron.list": cronListMock },
}));
vi.mock("../../config/config.js", () => ({ mutateConfigFileWithRetry: mutateMock }));

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../../skills");
const EMPTY_CONFIG = { agents: { entries: {} } } as unknown as BranchConfig;

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "trunk-template-handler-"));
}

function call(
  method: "trunks.template.create" | "trunks.template.export" | "trunks.template.list",
  params: Record<string, unknown>,
  cfg: BranchConfig = EMPTY_CONFIG,
) {
  const respond = vi.fn();
  const options = {
    params,
    respond,
    context: { getRuntimeConfig: () => cfg },
  } as unknown as GatewayRequestHandlerOptions;
  const handler = trunkTemplatesHandlers[method];
  if (!handler) {
    throw new Error(`${method} is not registered`);
  }
  return { respond, done: Promise.resolve(handler(options)) };
}

/** agents.create answers as the real handler does: agentId plus the workspace it created. */
function createAnswers(workspaceDir: string) {
  createMock.mockImplementation(
    async (options: { respond: (ok: boolean, payload?: unknown) => void }) => {
      options.respond(true, { ok: true, agentId: "newagent", workspace: workspaceDir });
    },
  );
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
      permissions: [
        "This template sets no tool restrictions. Tool switches are set per Trunk after creating it.",
      ],
      ...body,
    }),
  );
  return file;
}

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

type Respond = (ok: boolean, payload?: unknown, error?: unknown) => void;

/** cron.add answers as the real handler does for an imperative add: the job read view with its id. */
function cronAddAnswers() {
  let next = 0;
  cronAddMock.mockImplementation(
    async (options: { params: Record<string, unknown>; respond: Respond }) => {
      next += 1;
      options.respond(true, { id: `job-${next}`, ...options.params });
    },
  );
}

function cronListAnswers(jobs: unknown[]) {
  cronListMock.mockImplementation(async (options: { respond: Respond }) => {
    options.respond(true, {
      jobs,
      total: jobs.length,
      offset: 0,
      limit: 200,
      hasMore: false,
      nextOffset: null,
    });
  });
}

beforeEach(() => {
  process.env.BRANCH_STATE_DIR = workspace();
  createMock.mockReset();
  mutateMock.mockReset();
  cronAddMock.mockReset();
  cronListMock.mockReset();
  cronAddAnswers();
  cronListAnswers([]);
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
    expect(respond.mock.calls[0]?.[1]).toMatchObject({
      ok: true,
      agentId: "newagent",
      workspace: dir,
    });
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("# Researcher");
  });

  it("uses the workspace from the agents.create answer, not from the config", async () => {
    const dir = workspace();
    createAnswers(dir);
    const { respond, done } = call(
      "trunks.template.create",
      { templateId: "builder" },
      EMPTY_CONFIG,
    );
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
    const { respond, done } = call("trunks.template.create", {
      templatePath: "relative.trunk-template.json",
    });
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
    createMock.mockImplementation(
      async (options: { respond: (ok: boolean, payload?: unknown, error?: unknown) => void }) => {
        options.respond(false, undefined, { code: "INVALID_REQUEST", message: "name taken" });
      },
    );
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

  it("reports missing skills and a model family as warnings, not failures, and adds the routines", async () => {
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
    ]);
    expect(cronAddMock).toHaveBeenCalledTimes(1);
  });
});

describe("trunks.template.create adds routines turned off", () => {
  it("adds each routine through cron.add for the new Trunk, turned off, and reports them", async () => {
    createAnswers(workspace());
    const file = templateFile({
      automations: [
        { name: "Morning digest", cron: "0 8 * * 1-5", prompt: "Summarize my inbox." },
        { name: "Weekly review", cron: "0 9 * * 1", prompt: "Review the week." },
      ],
    });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(cronAddMock).toHaveBeenCalledTimes(2);
    expect(cronAddMock.mock.calls[0]?.[0].params).toEqual({
      name: "Morning digest",
      agentId: "newagent",
      enabled: false,
      schedule: { kind: "cron", expr: "0 8 * * 1-5" },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Summarize my inbox." },
    });
    const payload = respond.mock.calls[0]?.[1] as { routines: unknown[]; warnings: string[] };
    expect(payload.routines).toEqual([
      { id: "job-1", name: "Morning digest" },
      { id: "job-2", name: "Weekly review" },
    ]);
    expect(payload.warnings).toEqual([]);
  });

  it("keeps the Trunk and names a routine cron.add refuses in a warning", async () => {
    createAnswers(workspace());
    cronAddMock.mockImplementation(async (options: { respond: Respond }) => {
      options.respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: "invalid cron expression",
      });
    });
    const file = templateFile({
      automations: [{ name: "Broken", cron: "not a cron", prompt: "Hi." }],
    });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const payload = respond.mock.calls[0]?.[1] as { routines: unknown[]; warnings: string[] };
    expect(payload.routines).toEqual([]);
    expect(payload.warnings).toEqual([
      'Routine "Broken" could not be added: invalid cron expression',
    ]);
  });

  it("says which of the template's channels this computer has set up", async () => {
    createAnswers(workspace());
    const cfg = {
      agents: { entries: {} },
      channels: { telegram: { enabled: true }, slack: { enabled: false } },
    } as unknown as BranchConfig;
    const file = templateFile({ connections: ["telegram", "slack", "discord"] });
    const { respond, done } = call("trunks.template.create", { templatePath: file }, cfg);
    await done;
    const payload = respond.mock.calls[0]?.[1] as { connections: unknown };
    expect(payload.connections).toEqual([
      { id: "telegram", ready: true, bound: true },
      { id: "slack", ready: false, bound: false },
      { id: "discord", ready: false, bound: false },
    ]);
  });
});

describe("trunks.template catalog", () => {
  it("lists the ten bundled templates", async () => {
    const { respond, done } = call("trunks.template.list", {});
    await done;
    const payload = respond.mock.calls[0]?.[1] as {
      templates: Array<{ id: string; source: string }>;
    };
    expect(payload.templates.map((t) => [t.id, t.source])).toEqual([
      ["builder", "bundled"],
      ["home-desk", "bundled"],
      ["inbox-helper", "bundled"],
      ["lookout", "bundled"],
      ["night-shift", "bundled"],
      ["project-lead", "bundled"],
      ["prospect-finder", "bundled"],
      ["researcher", "bundled"],
      ["spend-saver", "bundled"],
      ["trunk-doctor", "bundled"],
    ]);
  });

  it("keeps a pasted template in the catalog, lists it as imported, and creates from its catalog id", async () => {
    createAnswers(workspace());
    const template = JSON.parse(
      readFileSync(
        templateFile({
          name: "Night Shift",
          automations: [{ name: "Prep", cron: "0 6 * * *", prompt: "Prep my morning." }],
        }),
        "utf8",
      ),
    );
    const first = call("trunks.template.create", { template });
    await first.done;
    const created = first.respond.mock.calls[0]?.[1] as { templateId: string };
    expect(created.templateId).toBe("imported:night-shift");
    const list = call("trunks.template.list", {});
    await list.done;
    const listed = list.respond.mock.calls[0]?.[1] as { templates: Array<Record<string, unknown>> };
    const templates = listed.templates;
    expect(templates.at(-1)).toEqual({
      id: "imported:night-shift",
      source: "imported",
      name: "Night Shift",
      description: "",
      skills: 0,
      routines: 1,
      connections: [],
    });
    createAnswers(workspace());
    const again = call("trunks.template.create", { templateId: "imported:night-shift" });
    await again.done;
    expect(again.respond.mock.calls[0]?.[0]).toBe(true);
    const againAnswer = again.respond.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(againAnswer.templateId).toBeUndefined();
  });

  it("refuses an imported id that tries to leave the catalog folder", async () => {
    const { respond, done } = call("trunks.template.create", { templateId: "imported:../secrets" });
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("answers a damaged link with one plain error and creates nothing", async () => {
    const { respond, done } = call("trunks.template.create", { link: "branch-template:1:%%%" });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("trunks.template export then import on another computer", () => {
  it("recreates the Trunk: persona, skills, routines turned off and the channel to set up, with no secrets or paths", async () => {
    const home = workspace();
    writeFileSync(
      path.join(home, "AGENTS.md"),
      `# Night Shift\n\nWork overnight. Notes live in ${home}.\n\n## Anti-jobs\n- Never send email.\n`,
    );
    writeFileSync(path.join(home, "SOUL.md"), "Calm.\n");
    const cfg = {
      agents: {
        entries: { night: { name: "Night Shift", workspace: home, skills: ["apple-notes"] } },
      },
      bindings: [{ agentId: "night", match: { channel: "telegram", accountId: "personal-bot" } }],
    } as unknown as BranchConfig;
    cronListAnswers([
      {
        id: "a",
        name: "Morning digest",
        effectiveAgentId: "night",
        schedule: { kind: "cron", expr: "0 7 * * *", tz: "Europe/Paris" },
        payload: { kind: "agentTurn", message: `Read ${home}/inbox.md and summarize.` },
        delivery: { mode: "announce", to: "12345" },
      },
      {
        id: "b",
        name: "Leaky",
        effectiveAgentId: "night",
        schedule: { kind: "cron", expr: "0 9 * * *" },
        payload: {
          kind: "agentTurn",
          message: "Use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 to post.",
        },
      },
      {
        id: "c",
        name: "Ping",
        effectiveAgentId: "night",
        schedule: { kind: "every", everyMs: 60000 },
        payload: { kind: "agentTurn", message: "Ping." },
      },
      {
        id: "d",
        name: "Other Trunk",
        effectiveAgentId: "main",
        schedule: { kind: "cron", expr: "0 9 * * *" },
        payload: { kind: "agentTurn", message: "Not mine." },
      },
    ]);
    const exported = call("trunks.template.export", { agentId: "night" }, cfg);
    await exported.done;
    expect(exported.respond.mock.calls[0]?.[0]).toBe(true);
    expect(cronListMock.mock.calls[0]?.[0].params).toMatchObject({
      agentId: "night",
      includeDisabled: true,
    });
    const shared = exported.respond.mock.calls[0]?.[1] as {
      link: string;
      template: Record<string, unknown>;
      warnings: string[];
    };
    const text = JSON.stringify(shared);
    expect(text).not.toContain(home);
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain("personal-bot");
    expect(text).not.toContain("12345");
    expect(shared.template.automations).toEqual([
      {
        name: "Morning digest",
        cron: "0 7 * * *",
        prompt: "Read <workspace>/inbox.md and summarize.",
      },
    ]);
    expect(shared.template.connections).toEqual(["telegram"]);
    expect(shared.warnings).toEqual([
      expect.stringContaining("looks like it contains a secret"),
      'Routine "Ping" is not a scheduled prompt, so the template leaves it out.',
    ]);

    // Another computer: a fresh state folder and workspace, no channels set up.
    process.env.BRANCH_STATE_DIR = workspace();
    const target = workspace();
    createAnswers(target);
    cronAddMock.mockClear();
    const imported = call("trunks.template.create", { link: shared.link });
    await imported.done;
    expect(imported.respond.mock.calls[0]?.[0]).toBe(true);
    expect(readFileSync(path.join(target, "AGENTS.md"), "utf8")).toContain("- Never send email.");
    expect(readFileSync(path.join(target, "SOUL.md"), "utf8")).toBe("Calm.\n");
    expect(cronAddMock).toHaveBeenCalledTimes(1);
    expect(cronAddMock.mock.calls[0]?.[0].params).toMatchObject({
      name: "Morning digest",
      enabled: false,
      agentId: "newagent",
    });
    expect(imported.respond.mock.calls[0]?.[1]).toMatchObject({
      name: "Night Shift",
      templateId: "imported:night-shift",
      routines: [{ id: "job-1", name: "Morning digest" }],
      connections: [{ id: "telegram", ready: false, bound: false }],
    });
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

  it("adds the template's denyTools to the new Trunk's tools.deny", async () => {
    createAnswers(workspace());
    const file = templateFile({ toolsets: { sessions: true }, denyTools: ["sessions_spawn", "subagents"] });
    const { respond, done } = call("trunks.template.create", { templatePath: file });
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(draft.current.agents.entries.newagent.tools.deny).toEqual(["sessions_spawn", "subagents"]);
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
      new Error(
        "EACCES: open '/Users/taofikbishi/secret/config.json' token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      ),
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
    const cfg = {
      agents: { entries: { ops: { name: "Ops", workspace: dir } } },
    } as unknown as BranchConfig;
    const { respond, done } = call("trunks.template.export", { agentId: "ops" }, cfg);
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls[0])).not.toContain("ghp_");
  });
});

// A token shaped like a GitHub personal access token, built in pieces so no scanner flags this file.
const FAKE_TOKEN = ["ghp", "Zq7Lm2Xc9Vb4Nk8Rt1Yp6Wd3Hs5Jf0Ga2Ue7"].join("_");

function pastedTemplate(body: Record<string, unknown> = {}): TrunkTemplate {
  return {
    format: "branch.trunk-template",
    version: 1,
    name: "Custom",
    description: "",
    persona: { agentsMd: "# Custom\n" },
    skills: [],
    toolsets: {},
    permissions: [
      "This template sets no tool restrictions. Tool switches are set per Trunk after creating it.",
    ],
    ...body,
  } as TrunkTemplate;
}

function importedCatalogFiles(): string[] {
  const dir = path.join(process.env.BRANCH_STATE_DIR ?? "", "trunk-templates");
  return existsSync(dir) ? readdirSync(dir).toSorted() : [];
}

function importedCatalogText(): string {
  const dir = path.join(process.env.BRANCH_STATE_DIR ?? "", "trunk-templates");
  return importedCatalogFiles()
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
}

describe("trunks.template.create never writes secrets from an outside template", () => {
  it("leaves out a linked routine whose prompt carries a token, from cron.add and from the catalog", async () => {
    createAnswers(workspace());
    const link = encodeTrunkTemplateLink(
      pastedTemplate({
        name: "Poster",
        automations: [
          { name: "Post", cron: "0 9 * * *", prompt: "Use token " + FAKE_TOKEN + " to post." },
          { name: "Digest", cron: "0 8 * * *", prompt: "Summarize my inbox." },
        ],
      }),
    );
    const { respond, done } = call("trunks.template.create", { link });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(cronAddMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(cronAddMock.mock.calls)).not.toContain(FAKE_TOKEN);
    expect(cronAddMock.mock.calls[0]?.[0].params).toMatchObject({ name: "Digest", enabled: false });
    expect(importedCatalogFiles()).toEqual(["poster.branch.trunk-template.json"]);
    expect(importedCatalogText()).not.toContain(FAKE_TOKEN);
    expect(importedCatalogText()).toContain("Summarize my inbox.");
    const payload = respond.mock.calls[0]?.[1] as { routines: unknown[]; warnings: string[] };
    expect(payload.routines).toEqual([{ id: "job-1", name: "Digest" }]);
    expect(payload.warnings).toEqual([expect.stringContaining("looks like it contains a secret")]);
    expect(JSON.stringify(respond.mock.calls)).not.toContain(FAKE_TOKEN);
  });

  it("refuses a pasted template whose persona carries a token, before creating or keeping anything", async () => {
    const dir = workspace();
    createAnswers(dir);
    const template = pastedTemplate({
      persona: { agentsMd: "# Ops\n\nDeploy with " + FAKE_TOKEN + ".\n" },
    });
    const { respond, done } = call("trunks.template.create", { template });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toContain(
      "looks like it contains a secret",
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain(FAKE_TOKEN);
    expect(createMock).not.toHaveBeenCalled();
    expect(cronAddMock).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(importedCatalogFiles()).toEqual([]);
  });

  it("refuses a linked SOUL.md that holds a private key", async () => {
    createAnswers(workspace());
    const keyLabel = ["PRIVATE", "KEY"].join(" ");
    const pem = `-----BEGIN ${keyLabel}-----\nabc\n-----END ${keyLabel}-----\n`;
    const link = encodeTrunkTemplateLink(
      pastedTemplate({ persona: { agentsMd: "# Ops\n", soulMd: pem } }),
    );
    const { respond, done } = call("trunks.template.create", { link });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
    expect(importedCatalogFiles()).toEqual([]);
  });
});

describe("trunks.template.create link size cap", () => {
  it("answers a link that inflates past 256 KB with one error and creates nothing", async () => {
    const big = JSON.stringify(pastedTemplate({ persona: { agentsMd: "a".repeat(300 * 1024) } }));
    const link =
      "branch-template:1:" + deflateRawSync(Buffer.from(big, "utf8")).toString("base64url");
    expect(link.length).toBeLessThan(4096);
    const { respond, done } = call("trunks.template.create", { link });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(String(respond.mock.calls[0]?.[2]?.message ?? "")).toContain("larger than 256 KB");
    expect(createMock).not.toHaveBeenCalled();
    expect(importedCatalogFiles()).toEqual([]);
  });
});

describe("trunks.template.create binds the template's channels that are set up here", () => {
  it("adds a channel binding for the new Trunk when the channel is set up, and says so", async () => {
    createAnswers(workspace());
    const cfg = {
      agents: { entries: {} },
      channels: { telegram: { enabled: true } },
    } as unknown as BranchConfig;
    const { respond, done } = call(
      "trunks.template.create",
      { template: pastedTemplate({ connections: ["telegram", "slack"] }) },
      cfg,
    );
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(draft.current.bindings).toEqual([
      { agentId: "newagent", match: { channel: "telegram" } },
    ]);
    const payload = respond.mock.calls[0]?.[1] as { connections: unknown; warnings: string[] };
    expect(payload.connections).toEqual([
      { id: "telegram", ready: true, bound: true },
      { id: "slack", ready: false, bound: false },
    ]);
    expect(payload.warnings).toEqual([
      expect.stringContaining("Messages on telegram now go to this Trunk"),
    ]);
  });

  it("keeps an existing binding for that channel and reports it instead of taking it over", async () => {
    createAnswers(workspace());
    const existing = { agentId: "main", match: { channel: "telegram" } };
    draft.current.bindings = [existing];
    const cfg = {
      agents: { entries: {} },
      channels: { telegram: { enabled: true } },
    } as unknown as BranchConfig;
    const { respond, done } = call(
      "trunks.template.create",
      { template: pastedTemplate({ connections: ["telegram"] }) },
      cfg,
    );
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(draft.current.bindings).toEqual([existing]);
    const payload = respond.mock.calls[0]?.[1] as { connections: unknown; warnings: string[] };
    expect(payload.connections).toEqual([{ id: "telegram", ready: true, bound: false }]);
    expect(payload.warnings).toEqual([
      expect.stringContaining('already sends its messages to Trunk "main"'),
    ]);
  });

  it("writes no binding when none of the template's channels is set up", async () => {
    createAnswers(workspace());
    const { respond, done } = call("trunks.template.create", {
      template: pastedTemplate({ connections: ["telegram"] }),
    });
    await done;
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(draft.current.bindings).toBeUndefined();
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

describe("trunks.template.create keeps the imported catalog consistent", () => {
  it("keeps no catalog entry when the Trunk could not be created", async () => {
    createMock.mockImplementation(async (options: { respond: Respond }) => {
      options.respond(false, undefined, { code: "INVALID_REQUEST", message: "name taken" });
    });
    const { respond, done } = call("trunks.template.create", {
      template: pastedTemplate({ name: "Taken" }),
    });
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(importedCatalogFiles()).toEqual([]);
  });

  it("keeps two templates with non-Latin names apart", async () => {
    createAnswers(workspace());
    const first = call("trunks.template.create", { template: pastedTemplate({ name: "研究者" }) });
    await first.done;
    createAnswers(workspace());
    const second = call("trunks.template.create", { template: pastedTemplate({ name: "助手" }) });
    await second.done;
    const firstAnswer = first.respond.mock.calls[0]?.[1] as { templateId: string };
    const secondAnswer = second.respond.mock.calls[0]?.[1] as { templateId: string };
    const firstId = firstAnswer.templateId;
    const secondId = secondAnswer.templateId;
    expect(firstId).toMatch(/^imported:template-[a-f0-9]{8}$/);
    expect(secondId).toMatch(/^imported:template-[a-f0-9]{8}$/);
    expect(firstId).not.toBe(secondId);
    const list = call("trunks.template.list", {});
    await list.done;
    const listed = list.respond.mock.calls[0]?.[1] as {
      templates: Array<{ name: string; source: string }>;
    };
    const names = listed.templates.filter((t) => t.source === "imported").map((t) => t.name);
    expect(names.toSorted()).toEqual(["助手", "研究者"].toSorted());
  });

  it("gives a different template whose name makes the same slug its own entry, and replaces one with the same name", async () => {
    for (const name of ["Night Shift", "Night-Shift", "Night Shift"]) {
      createAnswers(workspace());
      await call("trunks.template.create", { template: pastedTemplate({ name }) }).done;
    }
    expect(importedCatalogFiles()).toEqual([
      "night-shift-2.branch.trunk-template.json",
      "night-shift.branch.trunk-template.json",
    ]);
    expect(importedCatalogText()).toContain('"name": "Night-Shift"');
  });
});
