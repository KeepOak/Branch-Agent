import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listToolsetIds } from "../agents/tool-toolsets.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { GatewayRequestHandlerOptions } from "../gateway/server-methods/shared-types.js";
import { trunkTemplatesHandlers } from "../gateway/server-methods/trunk-templates.js";
import { fillAnswerSlots, resolveFirstRunAnswers } from "./trunk-template-first-run.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

const { createMock, mutateMock, cronAddMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  mutateMock: vi.fn(),
  cronAddMock: vi.fn(),
}));
vi.mock("../gateway/server-methods/agents.js", () => ({
  agentsHandlers: { "agents.create": createMock },
}));
vi.mock("../gateway/server-methods/cron.js", () => ({
  cronHandlers: { "cron.add": cronAddMock, "cron.list": vi.fn(), "cron.update": vi.fn() },
}));
vi.mock("../config/config.js", () => ({ mutateConfigFileWithRetry: mutateMock }));

type Respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => void;

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../skills");
const FILE = path.join(BUNDLED_SKILLS, "trunk-templates/mentions-watch.branch.trunk-template.json");
const FRESH = { agents: { entries: { main: {} } } } as unknown as BranchConfig;
/** The tools the card lists: built-in web search and page reading, plus files for the seen-links list. */
const LISTED_TOOLSETS = ["files", "web"];

function loadTemplate(): TrunkTemplate {
  expect(existsSync(FILE)).toBe(true);
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  expect(parsed.warnings).toEqual([]);
  return parsed.template;
}

async function call(method: string, params: Record<string, unknown>) {
  const respond = vi.fn();
  await trunkTemplatesHandlers[method]?.({
    params,
    respond,
    context: { getRuntimeConfig: () => FRESH },
  } as unknown as GatewayRequestHandlerOptions);
  expect(respond).toHaveBeenCalledTimes(1);
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return { ok: ok as boolean, payload: payload as Record<string, any>, error };
}

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

beforeEach(() => {
  process.env.BRANCH_STATE_DIR = mkdtempSync(path.join(os.tmpdir(), "mentions-watch-"));
  for (const mock of [createMock, mutateMock, cronAddMock]) {
    mock.mockReset();
  }
  const workspace = mkdtempSync(path.join(os.tmpdir(), "mentions-watch-ws-"));
  createMock.mockImplementation(async (options: { respond: Respond }) => {
    options.respond(true, { ok: true, agentId: "newagent", workspace });
  });
  mutateMock.mockResolvedValue({});
  cronAddMock.mockImplementation(
    async (options: { params: Record<string, any>; respond: Respond }) => {
      options.respond(true, { id: "job-1", ...options.params, state: {} });
    },
  );
});

describe("Mentions Watch day-one template: first run", () => {
  it("parses cleanly and asks two or three questions, each with a default", () => {
    const template = loadTemplate();
    expect(template.name).toBe("Mentions Watch");
    const firstRun = template.firstRun!;
    expect(firstRun.questions.map((question) => question.id)).toEqual(["watch", "own", "extra"]);
    for (const question of firstRun.questions) {
      expect(question.default.trim()).not.toBe("");
    }
    expect(firstRun.timezone).toBe("owner");
    expect(firstRun.schedule).toBe("paused-until-start");
    expect(firstRun.result.title).toBe("Mentions Watch");
    expect(firstRun.result.summary).toMatch(/every weekday at 8:30/);
    expect(firstRun.result.summary).toMatch(/Silent on quiet days/);
  });

  it("switches on only the tools the card lists", () => {
    const { toolsets } = loadTemplate();
    const on = Object.entries(toolsets).flatMap(([id, enabled]) => (enabled ? [id] : []));
    expect(on.toSorted()).toEqual(LISTED_TOOLSETS);
    for (const id of listToolsetIds().filter((id) => !LISTED_TOOLSETS.includes(id))) {
      expect(toolsets[id]).toBe(false);
    }
  });

  it("is offered first when the owner's goal is about mentions of their brand", async () => {
    const { ok, payload } = await call("trunks.template.starters", {
      agentId: "main",
      goal: "keep an eye on mentions of my brand",
    });
    expect(ok).toBe(true);
    expect(payload.offer[0]).toMatchObject({ id: "mentions-watch" });
    expect(payload.offer[0].questions).toHaveLength(3);
  });

  it("writes its own words, with no credit or link to another product", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).not.toMatch(/inspired|overheard|grok|marketplace|https?:\/\//i);
  });
});

describe("Mentions Watch day-one template: one scheduled run", () => {
  it("has one weekday 8:30 routine that defaults to Reddit, Hacker News, news and X", () => {
    const template = loadTemplate();
    expect(template.automations).toHaveLength(1);
    const routine = template.automations![0]!;
    expect(routine.cron).toBe("30 8 * * 1-5");
    const answers = resolveFirstRunAnswers(template.firstRun!, {});
    const prompt = fillAnswerSlots(routine.prompt, answers);
    expect(prompt).not.toContain("{{answers.");
    for (const question of template.firstRun!.questions) {
      expect(prompt).toContain(question.default);
    }
    expect(prompt).toMatch(/Check Reddit, Hacker News, news sites and X\./);
    expect(prompt).toMatch(/If there is nothing new, reply NO_REPLY\./);
    const optIn = template.firstRun!.questions.find((question) => question.id === "extra")!;
    expect(optIn.prompt).toMatch(/YouTube, Instagram or TikTok/);
    expect(optIn.default).toMatch(/None/);
  });

  it("is added paused, in the owner's timezone, with the owner's answers, when the Trunk is created", async () => {
    const template = loadTemplate();
    const answers = { watch: "Acme Kites, acmekites.example", extra: "YouTube" };
    const created = await call("trunks.template.create", {
      templateId: "mentions-watch",
      timezone: "Europe/Berlin",
      answers,
    });
    expect(created.ok).toBe(true);
    expect(created.payload.firstRun).toMatchObject({ timezone: "Europe/Berlin", started: false });
    expect(cronAddMock).toHaveBeenCalledTimes(1);
    const added = cronAddMock.mock.calls[0]?.[0].params;
    expect(added.enabled).toBe(false);
    expect(added.schedule).toEqual({ kind: "cron", expr: "30 8 * * 1-5", tz: "Europe/Berlin" });
    const filled = resolveFirstRunAnswers(template.firstRun!, answers);
    expect(added.payload.message).toBe(fillAnswerSlots(template.automations![0]!.prompt, filled));
    expect(added.payload.message).toContain("Watch for: Acme Kites, acmekites.example.");
    expect(added.payload.message).toContain("Optional sources the owner chose: YouTube.");
    const agents = readFileSync(path.join(created.payload.workspace, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Mentions Watch");
    expect(agents).toContain("- Timezone: Europe/Berlin");
  });
});

describe("Mentions Watch day-one template: approval held for every outbound action", () => {
  it("only reads, never invents a hit, and leaves anything outbound to the owner's yes", () => {
    const template = loadTemplate();
    const persona = template.persona.agentsMd;
    const never = persona.slice(persona.indexOf("## Never"));
    for (const action of ["post", "reply", "message", "email", "buy", "spend", "sign"]) {
      expect(never).toMatch(new RegExp("\\b" + action + "\\b"));
    }
    expect(never).toMatch(/never contact the people who mentioned the owner/);
    expect(never).toMatch(/Never invent a mention, a link, a quote or a date/);
    expect(never).toMatch(/waits for their yes through Ask first/);
    expect(persona).toMatch(/reply NO_REPLY so the owner hears nothing/);
    expect(template.automations![0]!.prompt).toMatch(/Read only: post, reply to or contact no one\./);
    expect(template.permissions.join(" ")).toMatch(/waits for your yes in Inbox \(Ask first\)/);
    for (const id of ["messaging", "browser", "shell", "secrets", "automation"]) {
      expect(template.toolsets[id]).toBe(false);
    }
  });
});
