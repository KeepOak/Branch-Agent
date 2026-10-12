// Canopy tests cover the two-way GitHub Issues sync and its CLI entry point.
import type { CanopyCard } from "@branch/canopy-contract";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCanopyCli } from "./cli.js";
import { planCanopyGitHubSync, type GitHubSyncIssue } from "./github-issues-sync.js";
import type { CanopyStore } from "./store.js";
import { createCanopySqliteTestStore } from "./test/sqlite-store.js";

const gatewayRuntime = vi.hoisted(() => ({
  callGatewayFromCli: vi.fn(),
}));

vi.mock("branch/plugin-sdk/gateway-runtime", async () => {
  const actual = await vi.importActual<typeof import("branch/plugin-sdk/gateway-runtime")>(
    "branch/plugin-sdk/gateway-runtime",
  );
  return { ...actual, callGatewayFromCli: gatewayRuntime.callGatewayFromCli };
});

const REPO = "acme/widgets";
const ISSUE_URL = "https://github.com/acme/widgets/issues/";

type FakeIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
};

function fakeIssue(number: number, input: Partial<FakeIssue> & { at: number }): FakeIssue {
  return {
    number,
    title: "Issue " + number,
    body: null,
    state: "open",
    labels: [],
    html_url: ISSUE_URL + number,
    ...input,
    updated_at: new Date(input.at).toISOString(),
  };
}

/** In-memory GitHub issues API: GET lists, PATCH edits and bumps updated_at like GitHub does. */
function createFakeGitHub(issues: FakeIssue[], now: () => number) {
  const patches: Array<{ number: number; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.pathname.startsWith("/repos/" + REPO + "/issues")).toBe(true);
    if (init?.method === "PATCH") {
      const number = Number(url.pathname.split("/").at(-1));
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ number, body });
      const issue = issues.find((entry) => entry.number === number)!;
      if (body.state === "open" || body.state === "closed") {
        issue.state = body.state;
      }
      if (Array.isArray(body.labels)) {
        issue.labels = (body.labels as string[]).map((name) => ({ name }));
      }
      issue.updated_at = new Date(now()).toISOString();
      return new Response(JSON.stringify(issue), { status: 200 });
    }
    return new Response(JSON.stringify(issues), { status: 200 });
  });
  return { fetchImpl, patches };
}

/** Routes the CLI's Gateway calls to a real Canopy store and a fixed Trunk queue. */
function routeGateway(store: CanopyStore, queueItems: unknown[]) {
  gatewayRuntime.callGatewayFromCli.mockImplementation(
    async (method: string, _options: unknown, params: Record<string, unknown>) => {
      switch (method) {
        case "canopy.cards.list":
          return { cards: await store.list({ boardId: params.boardId }) };
        case "canopy.cards.create":
          return { card: await store.create(params) };
        case "canopy.cards.update":
          return {
            card: await store.update(String(params.id), params.patch as Record<string, unknown>, {
              expectedUpdatedAt: params.expectedUpdatedAt as number,
            }),
          };
        case "trunks.queue.list":
          return { items: queueItems };
        default:
          throw new Error("unexpected gateway method " + method);
      }
    },
  );
}

function createProgram(store: CanopyStore): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  registerCanopyCli({ program, store });
  return program;
}

async function runSync(program: Command): Promise<string> {
  const chunks: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk): boolean => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    await program.parseAsync(["canopy", "github-sync", "--repo", REPO], { from: "user" });
    return chunks.join("");
  } finally {
    write.mockRestore();
  }
}

function byUrl(cards: CanopyCard[], number: number): CanopyCard | undefined {
  return cards.find((card) => card.sourceUrl === ISSUE_URL + number);
}

describe("canopy github-sync", () => {
  beforeEach(() => {
    gatewayRuntime.callGatewayFromCli.mockReset();
    vi.stubEnv("GH_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("brings issues onto the board, follows the Trunk queue, and syncs status both ways", async () => {
    const store = createCanopySqliteTestStore();
    const base = Date.now();
    // Card the user finished locally after the issue last changed: Canopy wins, the issue closes.
    const finishedHere = await store.create({
      title: "Issue 3",
      status: "done",
      sourceUrl: ISSUE_URL + "3",
    });
    // Card that is stale against a newer closed issue: GitHub wins, the card moves to done.
    const closedThere = await store.create({
      title: "Issue 4",
      status: "todo",
      sourceUrl: ISSUE_URL + "4",
    });
    let clock = base + 60_000;
    const issues = [
      fakeIssue(1, {
        at: base - 1000,
        title: "Ready engine work",
        body: "Do the thing",
        labels: [{ name: "status:ready" }, { name: "prio:p1" }, { name: "area:engine" }],
      }),
      fakeIssue(2, { at: base - 1000, title: "Claimed by a Trunk" }),
      fakeIssue(3, {
        at: finishedHere.updatedAt - 1000,
        labels: [{ name: "status:ready" }, { name: "area:window" }],
      }),
      fakeIssue(4, { at: closedThere.updatedAt + 1000, state: "closed" }),
      fakeIssue(5, { at: base, title: "A pull request", pull_request: {} }),
    ];
    const github = createFakeGitHub(issues, () => (clock += 1000));
    vi.stubGlobal("fetch", github.fetchImpl);
    routeGateway(store, [
      {
        id: "job-1",
        status: "claimed",
        claimed_by: "builder-2",
        brief_text: "## JOB\nFix it\nBOARD: " + ISSUE_URL + "2; claim it on the board first",
      },
      // A queued job does not own its card yet.
      { id: "job-2", status: "queued", brief_text: "BOARD: " + ISSUE_URL + "1" },
    ]);

    const output = await runSync(createProgram(store));
    expect(output).toContain("github-sync complete: created=2 updated=1 pushed=1 failures=0");

    const cards = await store.list();
    expect(cards).toHaveLength(4);
    expect(byUrl(cards, 1)).toMatchObject({
      title: "Ready engine work",
      notes: "Do the thing",
      status: "todo",
      priority: "high",
      labels: ["prio:p1", "area:engine"],
    });
    expect(byUrl(cards, 2)).toMatchObject({ status: "running", agentId: "builder-2" });
    expect(byUrl(cards, 4)?.status).toBe("done");
    expect(byUrl(cards, 5)).toBeUndefined();
    expect(github.patches).toEqual([
      { number: 3, body: { state: "closed", labels: ["area:window"] } },
    ]);
    expect(github.fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
    });

    // A second pass, as a second device would run it, changes nothing and duplicates nothing.
    const again = await runSync(createProgram(store));
    expect(again).toContain("created=0 updated=0 pushed=0 failures=0");
    expect(await store.list()).toHaveLength(4);
  });

  it("refuses to run without a GitHub token", async () => {
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    const store = createCanopySqliteTestStore();
    await expect(runSync(createProgram(store))).rejects.toThrow(/GH_TOKEN or GITHUB_TOKEN/u);
    expect(gatewayRuntime.callGatewayFromCli).not.toHaveBeenCalled();
  });
});

describe("planCanopyGitHubSync", () => {
  const card = (patch: Partial<CanopyCard>): CanopyCard => ({
    id: "card-1",
    title: "Issue 7",
    status: "todo",
    priority: "normal",
    labels: [],
    position: 0,
    createdAt: 1,
    updatedAt: 1000,
    sourceUrl: ISSUE_URL + "7",
    ...patch,
  });
  const issue = (patch: Partial<GitHubSyncIssue>): GitHubSyncIssue => ({
    number: 7,
    title: "Issue 7",
    state: "open",
    labels: ["status:ready"],
    htmlUrl: ISSUE_URL + "7",
    updatedAt: 500,
    ...patch,
  });

  it("does nothing when card and issue already agree", () => {
    const plan = planCanopyGitHubSync({ repo: REPO, cards: [card({})], issues: [issue({})] });
    expect(plan).toEqual({ createCards: [], updateCards: [], patchIssues: [] });
  });

  it("pushes a newer card move to the issue and keeps other labels", () => {
    const plan = planCanopyGitHubSync({
      repo: REPO,
      cards: [card({ status: "review" })],
      issues: [issue({ labels: ["status:ready", "bug"] })],
    });
    expect(plan.patchIssues).toEqual([{ number: 7, labels: ["bug", "status:review"] }]);
    expect(plan.updateCards).toEqual([]);
  });

  it("pulls a newer issue status and title onto the card", () => {
    const plan = planCanopyGitHubSync({
      repo: REPO,
      cards: [card({})],
      issues: [issue({ updatedAt: 2000, title: "Renamed", labels: ["status:blocked"] })],
    });
    expect(plan.updateCards).toEqual([
      {
        id: "card-1",
        expectedUpdatedAt: 1000,
        patch: { status: "blocked", title: "Renamed" },
      },
    ]);
    expect(plan.patchIssues).toEqual([]);
  });

  it("matches the queue job by exact issue number, not a prefix", () => {
    const plan = planCanopyGitHubSync({
      repo: REPO,
      cards: [],
      issues: [issue({ number: 7 })],
      queueJobs: [{ id: "q", status: "claimed", claimedBy: "b", briefText: ISSUE_URL + "70" }],
    });
    expect(plan.createCards[0]).toMatchObject({ status: "todo" });
    expect(plan.createCards[0]?.agentId).toBeUndefined();
  });
});
