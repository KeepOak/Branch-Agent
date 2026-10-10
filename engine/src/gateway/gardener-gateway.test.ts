import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addQueueItem,
  claimNextQueueItem,
  listQueueItems,
  STALE_CLAIM_MS,
} from "../agents/trunk-queue.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createObservationStore } from "../infra/gardener-inputs.js";
import { createGardenerIssueWriter } from "../infra/gardener-issue-writer.js";
import { GatewayScheduler, type GatewaySchedulerClock } from "../infra/gateway-scheduler.js";
import { createSignalWakeGitHub } from "../infra/signal-wakes/signal-wake-github.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { startGardenerForGateway, type GardenerGateway } from "./gardener-gateway.js";

const MINUTE = 60_000;
const START = Date.parse("2026-10-10T12:00:00Z");
const API = "https://api.github.test";
const OWNER = "example-owner";
const NAME = "example-repo";
const REPO_PATH = `/repos/${OWNER}/${NAME}`;
const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";
const TOKEN = "test-token";

type Call = { method: string; url: string; headers: Headers };

/**
 * Fake GitHub. Main's ref and check runs carry an ETag and answer If-None-Match with 304. Issue creation is recorded.
 * Nothing here touches the network.
 */
function fakeGitHub(options: { mainCheckFails: boolean }) {
  const calls: Call[] = [];
  const bodyFor = (url: string): unknown => {
    if (url.includes("/search/issues")) {
      return { total_count: 0, items: [] };
    }
    if (url === `${API}${REPO_PATH}/git/ref/heads/main`) {
      return { object: { sha: MAIN_SHA } };
    }
    if (url.startsWith(`${API}${REPO_PATH}/commits/${MAIN_SHA}/check-runs`)) {
      const conclusion = options.mainCheckFails ? "failure" : "success";
      return { check_runs: [{ name: "engine-tests", status: "completed", conclusion }] };
    }
    return undefined;
  };
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, headers });
    if (method === "POST") {
      return new Response(JSON.stringify({ number: calls.length }), { status: 201 });
    }
    const body = bodyFor(url);
    if (body === undefined) {
      return new Response("{}", { status: 404 });
    }
    const etag = `"etag:${url}"`;
    if (headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { etag } });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { etag } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

let dir = "";
let clock = START;
let savedStateDir: string | undefined;
let gateways: GardenerGateway[] = [];
const fakeClock: GatewaySchedulerClock = {
  now: () => clock,
  monotonicNow: () => clock,
  arm: () => () => {},
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gardener-gateway-"));
  savedStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = dir;
  clock = START;
  gateways = [];
});

afterEach(async () => {
  for (const gateway of gateways) {
    await gateway.stop();
  }
  resetPluginStateStoreForTests();
  if (savedStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = savedStateDir;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function gardenerConfig(overrides: { enabled?: boolean; repo?: string }): BranchConfig {
  return {
    agents: { gardener: { enabled: true, repo: `${OWNER}/${NAME}`, ...overrides } },
  } as BranchConfig;
}

/** Starts a gateway on a fresh shared client, the way the gateway does. Restart = call again after a state reset. */
function startGateway(options: {
  cfg: BranchConfig;
  github: ReturnType<typeof fakeGitHub>;
  onError?: (message: string) => void;
}): GardenerGateway {
  const reads = createSignalWakeGitHub({
    fetchImpl: options.github.fetchImpl,
    token: TOKEN,
    apiBase: API,
  });
  const gateway = startGardenerForGateway({
    getRuntimeConfig: () => options.cfg,
    scheduler: new GatewayScheduler({ clock: fakeClock }),
    reads,
    writeIssue: createGardenerIssueWriter({
      fetchImpl: options.github.fetchImpl,
      token: TOKEN,
      apiBase: API,
    }),
    observations: createObservationStore(),
    onError: options.onError ?? (() => {}),
    now: () => clock,
  });
  gateways.push(gateway);
  return gateway;
}

/** A claim that was taken at START and has seen no activity since. */
function staleClaimOnBuilder(): void {
  addQueueItem({ title: "Build the login page", brief_text: "Brief" }, undefined, START);
  claimNextQueueItem("builder-1", undefined, START);
}

const issuePosts = (github: ReturnType<typeof fakeGitHub>) =>
  github.calls.filter((call) => call.method === "POST");

describe("gardener gateway end to end", () => {
  it("enabled with a repo: a red main check and a stale claim each become a queue job and an issue", async () => {
    const github = fakeGitHub({ mainCheckFails: true });
    staleClaimOnBuilder();
    clock = START + STALE_CLAIM_MS;
    const result = await startGateway({ cfg: gardenerConfig({}), github }).tick();
    expect(result?.dryRun).toBe(false);
    expect(issuePosts(github)).toHaveLength(2);
    const titles = listQueueItems().map((item) => item.title);
    expect(titles).toContain(
      '[gardener:ci-main:engine-tests] Fix failing check on main: "engine-tests"',
    );
    expect(titles.some((title) => title.startsWith("[gardener:stale-claim:"))).toBe(true);
  });

  it("a repeated run inside the cooldown writes nothing, and reuses the cached main reads", async () => {
    const github = fakeGitHub({ mainCheckFails: true });
    staleClaimOnBuilder();
    clock = START + STALE_CLAIM_MS;
    const gateway = startGateway({ cfg: gardenerConfig({}), github });
    await gateway.tick();
    const postsAfterFirst = issuePosts(github).length;
    const queuedAfterFirst = listQueueItems().length;

    clock += 31 * MINUTE;
    const second = await gateway.tick();

    expect(issuePosts(github)).toHaveLength(postsAfterFirst);
    expect(listQueueItems()).toHaveLength(queuedAfterFirst);
    expect(second?.jobs).toEqual([]);
    expect(second?.suppressed.map((s) => s.reason)).toEqual(["cooldown", "cooldown"]);
    const refReads = github.calls.filter((call) => call.url.endsWith("/git/ref/heads/main"));
    expect(refReads.at(-1)?.headers.get("If-None-Match")).toBe(
      `"etag:${API}${REPO_PATH}/git/ref/heads/main"`,
    );
  });

  it("a restart with the same state store keeps the cooldown", async () => {
    const github = fakeGitHub({ mainCheckFails: true });
    staleClaimOnBuilder();
    clock = START + STALE_CLAIM_MS;
    const before = startGateway({ cfg: gardenerConfig({}), github });
    await before.tick();
    await before.stop();
    const postsBeforeRestart = issuePosts(github).length;

    resetPluginStateStoreForTests();
    clock += 31 * MINUTE;
    const afterRestart = await startGateway({ cfg: gardenerConfig({}), github }).tick();

    expect(issuePosts(github)).toHaveLength(postsBeforeRestart);
    expect(afterRestart?.jobs).toEqual([]);
    expect(afterRestart?.suppressed.every((s) => s.reason === "cooldown")).toBe(true);
  });

  it("an issue is written only when a repo is configured; without one the gateway makes no GitHub call", async () => {
    const github = fakeGitHub({ mainCheckFails: true });
    const onError = vi.fn();
    const noRepo = { agents: { gardener: { enabled: true } } } as BranchConfig;
    const result = await startGateway({ cfg: noRepo, github, onError }).tick();
    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("agents.gardener.repo"));
    expect(github.calls).toEqual([]);
  });

  it("disabled with a repo is off: no GitHub read, no issue, no queue job", async () => {
    const github = fakeGitHub({ mainCheckFails: true });
    staleClaimOnBuilder();
    clock = START + STALE_CLAIM_MS;
    const result = await startGateway({
      cfg: gardenerConfig({ enabled: false }),
      github,
    }).tick();
    expect(result).toBeUndefined();
    expect(github.calls).toEqual([]);
    expect(listQueueItems().every((item) => !item.title.startsWith("[gardener:"))).toBe(true);
  });
});
