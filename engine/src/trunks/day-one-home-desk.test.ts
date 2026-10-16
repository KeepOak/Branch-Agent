import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../gateway/server-methods/cron.js", () => ({ cronHandlers: { "cron.add": cronAddMock } }));
vi.mock("../config/config.js", () => ({ mutateConfigFileWithRetry: mutateMock }));

type Respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => void;

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../skills");
const FILE = path.join(BUNDLED_SKILLS, "trunk-templates", "home-desk.branch.trunk-template.json");
const FRESH = { agents: { entries: { main: {} } } } as unknown as BranchConfig;

function homeDesk(): TrunkTemplate {
  expect(existsSync(FILE), "the Home Desk template file ships with the engine").toBe(true);
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  expect(parsed.warnings).toEqual([]);
  return parsed.template;
}

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "home-desk-"));
}

async function create(params: Record<string, unknown>) {
  const respond = vi.fn();
  await trunkTemplatesHandlers["trunks.template.create"]?.({
    params,
    respond,
    context: { getRuntimeConfig: () => FRESH },
  } as unknown as GatewayRequestHandlerOptions);
  expect(respond).toHaveBeenCalledTimes(1);
  const [ok, payload] = respond.mock.calls[0] ?? [];
  return { ok: ok as boolean, payload: payload as Record<string, any> };
}

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

beforeEach(() => {
  process.env.BRANCH_STATE_DIR = tempDir();
  for (const mock of [createMock, mutateMock, cronAddMock]) {
    mock.mockReset();
  }
  const workspace = tempDir();
  createMock.mockImplementation(async (options: { respond: Respond }) => {
    options.respond(true, { ok: true, agentId: "homedesk", workspace });
  });
  mutateMock.mockResolvedValue({});
  cronAddMock.mockImplementation(
    async (options: { params: Record<string, unknown>; respond: Respond }) => {
      options.respond(true, { id: "job-1", ...options.params, state: {} });
    },
  );
});

describe("Home Desk day-one template: first run", () => {
  it("parses cleanly with two or three first-run questions, each with a default", () => {
    const template = homeDesk();
    expect(template.name).toBe("Home Desk");
    const firstRun = template.firstRun;
    expect(firstRun).toBeDefined();
    expect(firstRun?.questions.length).toBeGreaterThanOrEqual(2);
    expect(firstRun?.questions.length).toBeLessThanOrEqual(3);
    for (const question of firstRun?.questions ?? []) {
      expect(question.default.trim(), question.id).not.toBe("");
    }
    expect(firstRun?.timezone).toBe("owner");
    expect(firstRun?.schedule).toBe("paused-until-start");
    expect(firstRun?.result.title).toBe("Home Desk");
    expect(template.starter?.pitch).toBeTruthy();
  });

  it("has one job and only the listed tools: email, calendar and files", () => {
    const template = homeDesk();
    expect(template.automations).toHaveLength(1);
    expect(template.skills).toEqual([]);
    expect(template.toolsets.files).toBe(true);
    for (const off of ["browser", "shell", "computer", "messaging", "github", "media", "web"]) {
      expect(template.toolsets[off], off).toBe(false);
    }
    const never = template.persona.agentsMd.split("## Never")[1] ?? "";
    expect(never).toMatch(/Never send anything without the owner's yes/);
    expect(never).toMatch(/Never triage work email/);
    expect(never).toMatch(/Never act as a finance app/);
  });
});

describe("Home Desk day-one template: one scheduled run", () => {
  it("is a weekday 6:30 routine whose prompt fills from the default answers", () => {
    const template = homeDesk();
    const routine = template.automations?.[0];
    expect(routine?.cron).toBe("30 6 * * 1-5");
    const answers = resolveFirstRunAnswers(template.firstRun!, undefined);
    const message = fillAnswerSlots(routine?.prompt ?? "", answers);
    expect(message).not.toContain("{{answers.");
    for (const question of template.firstRun?.questions ?? []) {
      expect(message).toContain(question.default);
    }
  });

  it("is added through cron.add turned off, in the owner's timezone, until Start", async () => {
    const created = await create({ templateId: "home-desk", timezone: "America/Chicago" });
    expect(created.ok).toBe(true);
    expect(created.payload.firstRun).toMatchObject({ timezone: "America/Chicago", started: false });
    expect(cronAddMock).toHaveBeenCalledTimes(1);
    const added = cronAddMock.mock.calls[0]?.[0].params;
    expect(added.name).toBe("Morning card and paper");
    expect(added.enabled).toBe(false);
    expect(added.schedule).toEqual({ kind: "cron", expr: "30 6 * * 1-5", tz: "America/Chicago" });
    expect(added.payload.message).toContain("Household: Me and my family; schools, doctors and the usual bills.");
    expect(added.payload.message).toContain("Read only: My personal email and our family calendar.");
    expect(added.payload.message).not.toContain("{{answers.");
    const agents = readFileSync(path.join(created.payload.workspace, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Home Desk");
    expect(agents).toContain("- Timezone: America/Chicago");
  });
});

describe("Home Desk day-one template: approval held for every outbound action", () => {
  it("makes every send, spend, sign or post wait for the owner's yes", () => {
    const template = homeDesk();
    const askFirst = (template.persona.agentsMd.split("## Ask first")[1] ?? "").split("## Never")[0] ?? "";
    expect(askFirst).toContain("Every send, spend, sign or post waits for the owner.");
    expect(askFirst).toContain("explicit yes");
    for (const action of [/send, reply to, or forward/, /accept, decline or change/, /pay, buy, book, renew/, /sign, submit or upload/, /post anything/]) {
      expect(askFirst).toMatch(action);
    }
    expect(template.permissions.join(" ")).toContain("Ask first: every send, spend, sign or post waits for your yes.");
  });

  it("tells the scheduled run to draft only and send, pay, sign or post nothing on its own", () => {
    const prompt = homeDesk().automations?.[0]?.prompt ?? "";
    expect(prompt).toContain("send, accept, pay, sign or post nothing without the owner's yes");
  });
});
