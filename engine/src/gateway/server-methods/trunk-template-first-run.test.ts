import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import { trunkTemplatesHandlers } from "./trunk-templates.js";

const { createMock, mutateMock, cronAddMock, cronListMock, cronUpdateMock, jobs } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    mutateMock: vi.fn(),
    cronAddMock: vi.fn(),
    cronListMock: vi.fn(),
    cronUpdateMock: vi.fn(),
    jobs: { current: [] as Array<Record<string, any>> },
  }),
);
vi.mock("./agents.js", () => ({ agentsHandlers: { "agents.create": createMock } }));
vi.mock("./cron.js", () => ({
  cronHandlers: {
    "cron.add": cronAddMock,
    "cron.list": cronListMock,
    "cron.update": cronUpdateMock,
  },
}));
vi.mock("../../config/config.js", () => ({ mutateConfigFileWithRetry: mutateMock }));

type Respond = (ok: boolean, payload?: unknown, error?: { message?: string }) => void;
type Method =
  | "trunks.template.create"
  | "trunks.template.starters"
  | "trunks.template.start"
  | "trunks.template.stop"
  | "trunks.template.cards";

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../../skills");
const NEXT_RUN = Date.UTC(2026, 9, 13, 10, 30);
/** A fresh install: the main Trunk is the only one until a teammate is created. */
const FRESH: BranchConfig = { agents: { entries: { main: {} } } } as unknown as BranchConfig;
const WITH_TEAMMATE: BranchConfig = {
  agents: { entries: { main: {}, newagent: {} } },
} as unknown as BranchConfig;

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "trunk-first-run-"));
}

async function call(method: Method, params: Record<string, unknown>, cfg: BranchConfig = FRESH) {
  const respond = vi.fn();
  const options = {
    params,
    respond,
    context: { getRuntimeConfig: () => cfg },
  } as unknown as GatewayRequestHandlerOptions;
  await trunkTemplatesHandlers[method]?.(options);
  expect(respond).toHaveBeenCalledTimes(1);
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return {
    ok: ok as boolean,
    payload: payload as Record<string, any>,
    error: error as { message?: string } | undefined,
  };
}

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

beforeEach(() => {
  process.env.BRANCH_STATE_DIR = tempDir();
  for (const mock of [createMock, mutateMock, cronAddMock, cronListMock, cronUpdateMock]) {
    mock.mockReset();
  }
  jobs.current = [];
  const workspace = tempDir();
  createMock.mockImplementation(async (options: { respond: Respond }) => {
    options.respond(true, { ok: true, agentId: "newagent", workspace });
  });
  mutateMock.mockResolvedValue({});
  cronAddMock.mockImplementation(
    async (options: { params: Record<string, any>; respond: Respond }) => {
      const job = { id: "job-" + (jobs.current.length + 1), ...options.params, state: {} };
      jobs.current.push(job);
      options.respond(true, job);
    },
  );
  cronListMock.mockImplementation(async (options: { respond: Respond }) => {
    options.respond(true, {
      jobs: jobs.current,
      total: jobs.current.length,
      hasMore: false,
      nextOffset: null,
    });
  });
  cronUpdateMock.mockImplementation(
    async (options: { params: { id: string; patch: { enabled: boolean } }; respond: Respond }) => {
      const job = jobs.current.find((entry) => entry.id === options.params.id);
      if (!job) {
        options.respond(false, undefined, { message: "unknown cron job id" });
        return;
      }
      job.enabled = options.params.patch.enabled;
      job.state = job.enabled ? { nextRunAtMs: NEXT_RUN } : {};
      options.respond(true, job);
    },
  );
});

describe("trunks.template.starters", () => {
  it("offers a new user's main Trunk three teammates, each with questions that have defaults", async () => {
    const { ok, payload } = await call("trunks.template.starters", { agentId: "main" });
    expect(ok).toBe(true);
    expect(payload.offer).toHaveLength(3);
    expect(payload.offer.map((offer: { id: string }) => offer.id)).toEqual([
      "night-shift",
      "inbox-helper",
      "researcher",
    ]);
    for (const offer of payload.offer) {
      expect(offer.pitch).toBeTruthy();
      expect(offer.questions.length).toBeGreaterThanOrEqual(2);
      for (const question of offer.questions) {
        expect(question.default).toBeTruthy();
      }
    }
    expect(typeof payload.timezone).toBe("string");
  });

  it("puts the teammates that fit the owner's goal first", async () => {
    const { payload } = await call("trunks.template.starters", {
      agentId: "main",
      goal: "watch prices and build an app",
    });
    expect(
      payload.offer
        .slice(0, 2)
        .map((offer: { id: string }) => offer.id)
        .toSorted(),
    ).toEqual(["builder", "lookout"]);
  });

  it("gives any Trunk that is not the main one an empty offer, so a new teammate never recruits more", async () => {
    const other = await call("trunks.template.starters", { agentId: "newagent" }, WITH_TEAMMATE);
    expect(other.payload.offer).toEqual([]);
    expect(other.payload.reason).toContain("main Trunk");
    await call("trunks.template.create", { templateId: "night-shift" });
    const teammate = await call("trunks.template.starters", { agentId: "newagent" }, {
      agents: { entries: { newagent: {} } },
    } as unknown as BranchConfig);
    expect(teammate.payload.offer).toEqual([]);
  });
});

describe("trunks.template.create with a first-run contract", () => {
  it("adds routines paused, in the owner's timezone, with the answers filled in, and remembers the card", async () => {
    const created = await call("trunks.template.create", {
      templateId: "night-shift",
      answers: { topics: "AI chips" },
      timezone: "Europe/Berlin",
    });
    expect(created.ok).toBe(true);
    expect(created.payload.firstRun).toMatchObject({
      answers: { topics: "AI chips", watch: "Nothing specific yet" },
      timezone: "Europe/Berlin",
      started: false,
    });
    const added = cronAddMock.mock.calls[0]?.[0].params;
    expect(added.enabled).toBe(false);
    expect(added.schedule).toEqual({ kind: "cron", expr: "30 6 * * 1-5", tz: "Europe/Berlin" });
    expect(added.payload.message).toContain("Topics the owner follows: AI chips.");
    expect(added.payload.message).not.toContain("{{answers.");
    expect(cronUpdateMock).not.toHaveBeenCalled();
    const agents = readFileSync(path.join(created.payload.workspace, "AGENTS.md"), "utf8");
    expect(agents).toContain("# Night Shift");
    expect(agents).toContain("- Which topics should the morning digest cover? AI chips");
    expect(agents).toContain("- Timezone: Europe/Berlin");

    const cards = await call("trunks.template.cards", {}, WITH_TEAMMATE);
    expect(cards.payload.cards).toEqual([
      expect.objectContaining({
        agentId: "newagent",
        name: "Night Shift",
        title: "Night Shift",
        started: false,
      }),
    ]);
    expect(cards.payload.cards[0].nextRunAtMs).toBeUndefined();
  });

  it("refuses a timezone that is not one, before any Trunk is created", async () => {
    const { ok, error } = await call("trunks.template.create", {
      templateId: "night-shift",
      timezone: "Mars/Olympus",
    });
    expect(ok).toBe(false);
    expect(error?.message).toContain("is not a timezone");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("leaves a template without a first-run contract exactly as before", async () => {
    const template = {
      format: "branch.trunk-template",
      version: 1,
      name: "Plain",
      persona: { agentsMd: "# Plain\n" },
      skills: [],
      toolsets: {},
      automations: [{ name: "Daily", cron: "0 9 * * *", prompt: "Say {{answers.x}}" }],
      permissions: ["p"],
    };
    const created = await call("trunks.template.create", { template, timezone: "Mars/Olympus" });
    expect(created.ok).toBe(true);
    expect(created.payload.firstRun).toBeUndefined();
    const added = cronAddMock.mock.calls[0]?.[0].params;
    expect(added.schedule).toEqual({ kind: "cron", expr: "0 9 * * *" });
    expect(added.payload.message).toBe("Say {{answers.x}}");
    expect((await call("trunks.template.cards", {}, WITH_TEAMMATE)).payload.cards).toEqual([]);
  });
});

describe("trunks.template.start and stop", () => {
  it("turns the paused routines on only when the owner starts the teammate, then off again on stop", async () => {
    await call("trunks.template.create", { templateId: "night-shift", timezone: "UTC" });
    expect(jobs.current[0]?.enabled).toBe(false);

    const started = await call("trunks.template.start", { agentId: "newagent" }, WITH_TEAMMATE);
    expect(started.ok).toBe(true);
    expect(cronUpdateMock.mock.calls[0]?.[0].params).toEqual({
      id: "job-1",
      patch: { enabled: true },
    });
    expect(started.payload.card).toMatchObject({
      started: true,
      nextRunAtMs: NEXT_RUN,
      timezone: "UTC",
    });
    expect(started.payload.warnings).toEqual([]);

    const card = (await call("trunks.template.cards", {}, WITH_TEAMMATE)).payload.cards[0];
    expect(card).toMatchObject({ started: true, nextRunAtMs: NEXT_RUN });

    const stopped = await call("trunks.template.stop", { agentId: "newagent" }, WITH_TEAMMATE);
    expect(stopped.payload.card.started).toBe(false);
    expect(stopped.payload.card.nextRunAtMs).toBeUndefined();
    expect(jobs.current[0]?.enabled).toBe(false);
  });

  it("starts a teammate with no routines and says when a routine could not be turned on", async () => {
    await call("trunks.template.create", { templateId: "builder" });
    const started = await call("trunks.template.start", { agentId: "newagent" }, WITH_TEAMMATE);
    expect(started.payload.card).toMatchObject({ started: true, routines: [] });

    await call("trunks.template.create", { templateId: "lookout" });
    jobs.current = [];
    const failed = await call("trunks.template.start", { agentId: "newagent" }, WITH_TEAMMATE);
    expect(failed.ok).toBe(true);
    expect(failed.payload.warnings[0]).toContain("could not be turned on");
  });

  it("refuses to start a Trunk that has no first-run setup", async () => {
    const { ok, error } = await call("trunks.template.start", { agentId: "main" });
    expect(ok).toBe(false);
    expect(error?.message).toContain("no first-run setup");
    expect(cronUpdateMock).not.toHaveBeenCalled();
  });

  it("drops the card of a Trunk that was deleted", async () => {
    await call("trunks.template.create", { templateId: "night-shift" });
    expect((await call("trunks.template.cards", {}, FRESH)).payload.cards).toEqual([]);
  });
});
