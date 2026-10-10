import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignalDecision } from "./signal-wake-decide.js";
import { createSignalWakeGitHub, type RepoRef } from "./signal-wake-github.js";
import { SIGNAL_POLL_INTERVAL_MS, startSignalWakePoller } from "./signal-wake-poller.js";
import { createMemorySignalStateStore, type SignalStateStore } from "./signal-wake-state.js";

const REPO: RepoRef = { owner: "KeepOak", name: "Branch-Agent" };
const TRUNK_HEAD = "trunk/builder-1-signal";
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

type FakePull = { number: number; login: string; ref: string; sha: string };
type FakeComment = { id: number; login: string; body: string };
type FakeCheck = { name: string; status: string; conclusion: string | null };
type FakeGitHub = {
  pulls: FakePull[];
  checks: Record<string, FakeCheck[]>;
  comments: Record<number, FakeComment[]>;
};

const GREEN: FakeCheck[] = [{ name: "build", status: "completed", conclusion: "success" }];
const RED: FakeCheck[] = [{ name: "test", status: "completed", conclusion: "failure" }];

function verdictBody(verdict: "MERGE" | "FIX", sha: string): string {
  return `branch-verdict: ${verdict} head=${sha}\n\n- problem one`;
}

function bodyFor(url: string, gh: FakeGitHub): unknown {
  const checkMatch = /\/commits\/([^/]+)\/check-runs/.exec(url);
  if (checkMatch) {
    return { total_count: 0, check_runs: gh.checks[checkMatch[1] ?? ""] ?? [] };
  }
  const commentMatch = /\/issues\/(\d+)\/comments/.exec(url);
  if (commentMatch) {
    const comments = gh.comments[Number(commentMatch[1])] ?? [];
    return comments.map((c) => ({ id: c.id, user: { login: c.login }, body: c.body }));
  }
  if (url.includes("/pulls?")) {
    return gh.pulls.map((p) => ({
      number: p.number,
      user: { login: p.login },
      head: { ref: p.ref, sha: p.sha },
    }));
  }
  return undefined;
}

/** A fake fetch that issues ETags and answers 304 when If-None-Match matches the current body. */
function fakeGitHub(gh: FakeGitHub) {
  const requests: { url: string; status: number; conditional: boolean }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = bodyFor(url, gh);
    if (body === undefined) {
      requests.push({ url, status: 404, conditional: false });
      return new Response("{}", { status: 404 });
    }
    const etag = `"${createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;
    const sent = new Headers(init?.headers).get("If-None-Match");
    if (sent === etag) {
      requests.push({ url, status: 304, conditional: true });
      return new Response(null, { status: 304, headers: { etag } });
    }
    requests.push({ url, status: 200, conditional: sent !== null });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", etag },
    });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const errors: string[] = [];

function start(options: {
  gh: FakeGitHub;
  notify: (signal: SignalDecision) => void;
  store?: SignalStateStore;
  intervalMs?: number;
}) {
  const fake = fakeGitHub(options.gh);
  const poller = startSignalWakePoller({
    github: createSignalWakeGitHub({ fetchImpl: fake.fetchImpl, token: "test-token" }),
    repos: [REPO],
    trunkIds: () => ["builder-1"],
    notify: options.notify,
    store: options.store ?? createMemorySignalStateStore(),
    onError: (message) => errors.push(message),
    intervalMs: options.intervalMs ?? 1e9,
  });
  return { poller, requests: fake.requests };
}

function openPr(headSha: string, ref = TRUNK_HEAD): FakeGitHub {
  return {
    pulls: [{ number: 7, login: "stabrea", ref, sha: headSha }],
    checks: { [headSha]: GREEN },
    comments: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
  errors.length = 0;
});

describe("signal wake poller", () => {
  it("spends no wake when every conditional read returns 304", async () => {
    const notify = vi.fn();
    const { poller, requests } = start({ gh: openPr(HEAD_A), notify });
    await poller.tick();
    requests.length = 0;
    await poller.tick();
    expect(requests.map((r) => r.status)).toEqual([304, 304, 304]);
    expect(requests.every((r) => r.conditional)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    await poller.stop();
  });

  it("wakes once for a red head and not again for the same red head", async () => {
    const notify = vi.fn();
    const gh = openPr(HEAD_A);
    const { poller } = start({ gh, notify });
    await poller.tick();
    gh.checks[HEAD_A] = RED;
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      reason: "ci-red",
      pr: 7,
      trunkId: "builder-1",
      contextKey: "signal:ci-red:7",
    });
    gh.checks[HEAD_A] = [...RED, { name: "lint", status: "completed", conclusion: "failure" }];
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    await poller.stop();
  });

  it("wakes once for a FIX verdict on the current head and dedupes by comment id", async () => {
    const notify = vi.fn();
    const gh = openPr(HEAD_A);
    const { poller } = start({ gh, notify });
    await poller.tick();
    gh.comments[7] = [{ id: 202, login: "stabrea", body: verdictBody("FIX", HEAD_A) }];
    await poller.tick();
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ reason: "fix-verdict", pr: 7 });
    gh.comments[7] = [
      { id: 202, login: "stabrea", body: verdictBody("FIX", HEAD_A) },
      { id: 203, login: "stabrea", body: verdictBody("FIX", HEAD_A) },
    ];
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(2);
    await poller.stop();
  });

  it("does not fire a FIX on an old head", async () => {
    const notify = vi.fn();
    const gh = openPr(HEAD_B);
    gh.comments[7] = [{ id: 301, login: "stabrea", body: verdictBody("FIX", HEAD_A) }];
    const { poller } = start({ gh, notify });
    await poller.tick();
    expect(notify).not.toHaveBeenCalled();
    await poller.stop();
  });

  it("does not fire a FIX that a newer MERGE verdict has superseded", async () => {
    const notify = vi.fn();
    const gh = openPr(HEAD_A);
    gh.comments[7] = [
      { id: 401, login: "stabrea", body: verdictBody("FIX", HEAD_A) },
      { id: 402, login: "stabrea", body: verdictBody("MERGE", HEAD_A) },
    ];
    const { poller } = start({ gh, notify });
    await poller.tick();
    expect(notify).not.toHaveBeenCalled();
    await poller.stop();
  });

  it("ignores PRs whose head branch does not belong to a configured Trunk", async () => {
    const notify = vi.fn();
    const gh: FakeGitHub = {
      pulls: [
        { number: 8, login: "stabrea", ref: "feature/x", sha: HEAD_B },
        { number: 9, login: "stabrea", ref: "trunk/unknown-1-x", sha: HEAD_B },
      ],
      checks: { [HEAD_B]: RED },
      comments: { 8: [{ id: 303, login: "reviewer", body: verdictBody("FIX", HEAD_B) }] },
    };
    const { poller, requests } = start({ gh, notify });
    await poller.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(requests.some((r) => r.url.includes("/commits/"))).toBe(false);
    await poller.stop();
  });

  it("restart with a red PR wakes once, then not again on later restarts", async () => {
    const store = createMemorySignalStateStore();
    const notify = vi.fn();
    const gh = openPr(HEAD_A);
    const first = start({ gh, notify, store });
    await first.poller.tick();
    await first.poller.stop();

    gh.checks[HEAD_A] = RED;
    const second = start({ gh, notify, store });
    await second.poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    await second.poller.tick();
    await second.poller.stop();

    const third = start({ gh, notify, store });
    await third.poller.tick();
    await third.poller.stop();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });

  it("polls at most once per interval", async () => {
    vi.useFakeTimers();
    const { poller, requests } = start({
      gh: openPr(HEAD_A),
      notify: vi.fn(),
      intervalMs: SIGNAL_POLL_INTERVAL_MS,
    });
    await vi.advanceTimersByTimeAsync(0);
    const pullCalls = () => requests.filter((r) => r.url.includes("/pulls?")).length;
    expect(pullCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(SIGNAL_POLL_INTERVAL_MS - 1);
    expect(pullCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pullCalls()).toBe(2);
    await poller.stop();
  });
});
