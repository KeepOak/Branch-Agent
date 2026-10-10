import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignalDecision } from "./signal-wake-decide.js";
import { createSignalWakeGitHub, type RepoRef } from "./signal-wake-github.js";
import { startSignalWakePoller, SIGNAL_POLL_INTERVAL_MS } from "./signal-wake-poller.js";

const REPO: RepoRef = { owner: "KeepOak", name: "Branch-Agent" };
const AUTHOR = "stabrea";
const TRUNK_HEAD = "trunk/builder-1-signal";

type FakePull = { number: number; login: string; ref: string; sha: string };
type FakeComment = { id: number; login: string; body: string };
type FakeCheck = { name: string; status: string; conclusion: string | null };
type FakeGitHub = {
  pulls: FakePull[];
  checks: Record<string, FakeCheck[]>;
  comments: Record<number, FakeComment[]>;
};

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

/** A fake fetch that issues real-looking ETags and answers 304 when If-None-Match matches. */
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

function start(gh: FakeGitHub, notify: (signal: SignalDecision) => void, intervalMs = 1e9) {
  const fake = fakeGitHub(gh);
  const poller = startSignalWakePoller({
    github: createSignalWakeGitHub({ fetchImpl: fake.fetchImpl, token: "test-token" }),
    repos: [REPO],
    trunkIds: () => ["builder-1"],
    notify,
    onError: (message) => errors.push(message),
    intervalMs,
  });
  return { poller, requests: fake.requests };
}

function greenGitHub(): FakeGitHub {
  return {
    pulls: [{ number: 7, login: AUTHOR, ref: TRUNK_HEAD, sha: "aaaaaaa1111" }],
    checks: { aaaaaaa1111: [{ name: "build", status: "completed", conclusion: "success" }] },
    comments: {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("signal wake poller", () => {
  it("spends no wake when every conditional read returns 304", async () => {
    const notify = vi.fn();
    const gh = greenGitHub();
    const { poller, requests } = start(gh, notify);
    await poller.tick();
    requests.length = 0;
    await poller.tick();
    expect(requests.map((r) => r.status)).toEqual([304, 304, 304]);
    expect(requests.every((r) => r.conditional)).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    await poller.stop();
  });

  it("wakes once for a red check and not again for the same red head", async () => {
    const notify = vi.fn();
    const gh = greenGitHub();
    const { poller } = start(gh, notify);
    await poller.tick();
    gh.checks.aaaaaaa1111 = [{ name: "test", status: "completed", conclusion: "failure" }];
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({
      reason: "ci-red",
      pr: 7,
      trunkId: "builder-1",
      contextKey: "signal:ci-red:7",
    });
    gh.checks.aaaaaaa1111 = [
      { name: "test", status: "completed", conclusion: "failure" },
      { name: "lint", status: "completed", conclusion: "failure" },
    ];
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    await poller.stop();
  });

  it("ignores a FIX comment posted by the PR author", async () => {
    const notify = vi.fn();
    const gh = greenGitHub();
    const { poller } = start(gh, notify);
    await poller.tick();
    gh.comments[7] = [{ id: 101, login: AUTHOR, body: "FIX\n- missing test" }];
    await poller.tick();
    expect(notify).not.toHaveBeenCalled();
    await poller.stop();
  });

  it("wakes once for a FIX comment from a non-author and dedupes by comment id", async () => {
    const notify = vi.fn();
    const gh = greenGitHub();
    const { poller } = start(gh, notify);
    await poller.tick();
    gh.comments[7] = [{ id: 202, login: "reviewer", body: "FIX\n- missing test" }];
    await poller.tick();
    await poller.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ reason: "fix-verdict", pr: 7 });
    await poller.stop();
  });

  it("ignores PRs whose head branch does not belong to a configured Trunk", async () => {
    const notify = vi.fn();
    const gh: FakeGitHub = {
      pulls: [
        { number: 8, login: AUTHOR, ref: "feature/x", sha: "bbbbbbb2222" },
        { number: 9, login: AUTHOR, ref: "trunk/unknown-1-x", sha: "ccccccc3333" },
      ],
      checks: { bbbbbbb2222: [{ name: "build", status: "completed", conclusion: "failure" }] },
      comments: { 8: [{ id: 303, login: "reviewer", body: "FIX\n- x" }] },
    };
    const { poller, requests } = start(gh, notify);
    await poller.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(requests.some((r) => r.url.includes("/commits/"))).toBe(false);
    await poller.stop();
  });

  it("polls at most once per interval", async () => {
    vi.useFakeTimers();
    const gh = greenGitHub();
    const { poller, requests } = start(gh, vi.fn(), SIGNAL_POLL_INTERVAL_MS);
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
