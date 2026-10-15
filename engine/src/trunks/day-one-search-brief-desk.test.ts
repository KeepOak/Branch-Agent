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
const FILE = path.join(BUNDLED_SKILLS, "trunk-templates/search-brief-desk.branch.trunk-template.json");
const FRESH = { agents: { entries: { main: {} } } } as unknown as BranchConfig;
/** The tools the card lists: web search, and files for keyword exports, ideas and briefs. */
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

async function create(params: Record<string, unknown>) {
  const respond = vi.fn();
  await trunkTemplatesHandlers["trunks.template.create"]?.({
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
  process.env.BRANCH_STATE_DIR = mkdtempSync(path.join(os.tmpdir(), "search-brief-desk-"));
  for (const mock of [createMock, mutateMock, cronAddMock]) {
    mock.mockReset();
  }
  const workspace = mkdtempSync(path.join(os.tmpdir(), "search-brief-desk-ws-"));
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

describe("Search Brief Desk day-one template: first run", () => {
  it("parses cleanly and asks two or three questions, each with a default", () => {
    const template = loadTemplate();
    expect(template.name).toBe("Search Brief Desk");
    const firstRun = template.firstRun!;
    expect(firstRun.questions.length).toBeGreaterThanOrEqual(2);
    expect(firstRun.questions.length).toBeLessThanOrEqual(3);
    for (const question of firstRun.questions) {
      expect(question.default.trim()).not.toBe("");
    }
    expect(firstRun.timezone).toBe("owner");
    expect(firstRun.schedule).toBe("paused-until-start");
    expect(firstRun.result.title).toBe("Search Brief Desk");
    expect(template.starter?.pitch).toBeTruthy();
  });

  it("switches on only the tools the card lists", () => {
    const { toolsets } = loadTemplate();
    const on = Object.entries(toolsets).flatMap(([id, enabled]) => (enabled ? [id] : []));
    expect(on.toSorted()).toEqual(LISTED_TOOLSETS);
    for (const id of listToolsetIds().filter((id) => !LISTED_TOOLSETS.includes(id))) {
      expect(toolsets[id]).toBe(false);
    }
  });
});

describe("Search Brief Desk day-one template: one scheduled run", () => {
  it("has one routine whose prompt fills from the default answers", () => {
    const template = loadTemplate();
    expect(template.automations).toHaveLength(1);
    const routine = template.automations![0]!;
    expect(routine.cron).toBe("0 9 * * 1");
    const answers = resolveFirstRunAnswers(template.firstRun!, {});
    const prompt = fillAnswerSlots(routine.prompt, answers);
    expect(prompt).not.toContain("{{answers.");
    for (const question of template.firstRun!.questions) {
      expect(prompt).toContain(question.default);
    }
  });

  it("is added paused, in the owner's timezone, with the default answers, when the Trunk is created", async () => {
    const template = loadTemplate();
    const created = await create({ templateId: "search-brief-desk", timezone: "America/Chicago" });
    expect(created.ok).toBe(true);
    expect(created.payload.firstRun).toMatchObject({ timezone: "America/Chicago", started: false });
    expect(cronAddMock).toHaveBeenCalledTimes(1);
    const added = cronAddMock.mock.calls[0]?.[0].params;
    expect(added.enabled).toBe(false);
    expect(added.schedule).toEqual({ kind: "cron", expr: "0 9 * * 1", tz: "America/Chicago" });
    const defaults = resolveFirstRunAnswers(template.firstRun!, {});
    expect(added.payload.message).toBe(fillAnswerSlots(template.automations![0]!.prompt, defaults));
    const agents = readFileSync(path.join(created.payload.workspace, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Search Brief Desk");
    expect(agents).toContain("- Timezone: America/Chicago");
  });
});

describe("Search Brief Desk day-one template: approval held for every outbound action", () => {
  it("keeps every send, post, spend and signature waiting for the owner's yes in Inbox through Ask first", () => {
    const template = loadTemplate();
    const persona = template.persona.agentsMd;
    const askFirst = persona.slice(persona.indexOf("## Ask first"), persona.indexOf("## Never"));
    expect(askFirst).toMatch(/Every send, spend, sign or post waits for the owner/);
    expect(askFirst).toMatch(/in Inbox through Ask first/);
    for (const action of ["send", "post", "publish", "pay", "buy", "sign"]) {
      expect(askFirst).toMatch(new RegExp("\\b" + action + "\\b"));
    }
    const never = persona.slice(persona.indexOf("## Never"));
    expect(never).toMatch(/Never send anything without the owner's approval/);
    expect(template.automations![0]!.prompt).toMatch(/hold any send or share in Inbox through Ask first; send nothing\./);
    expect(template.permissions.join(" ")).toMatch(/Every send, post, spend or signature waits for your yes in Inbox \(Ask first\)/);
    expect(template.toolsets.messaging).toBe(false);
    expect(template.toolsets.browser).toBe(false);
    expect(template.toolsets.secrets).toBe(false);
  });

  it("never publishes or edits the owner's site, the card's Never line", () => {
    const template = loadTemplate();
    const never = template.persona.agentsMd.slice(template.persona.agentsMd.indexOf("## Never"));
    expect(never).toMatch(/Never publish, edit or change the owner's site/);
    expect(template.description).toMatch(/Never publishes or edits your site/);
    expect(template.firstRun!.result.summary).toMatch(/never publishes or edits your site/);
    expect(template.automations![0]!.prompt).toMatch(/Do not publish or edit the site/);
    for (const id of ["browser", "shell", "computer", "github"]) {
      expect(template.toolsets[id]).toBe(false);
    }
  });
});

describe("Search Brief Desk day-one template: on request", () => {
  it("stays quiet on the weekly check when the owner added no new list", () => {
    const template = loadTemplate();
    expect(template.automations![0]!.prompt).toMatch(/If there is none, reply NO_REPLY\./);
    expect(template.firstRun!.result.summary).toMatch(/^Works on request/);
  });
});
