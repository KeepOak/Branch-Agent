import { describe, expect, it, vi } from "vitest";
import {
  createSignalWakeGitHub,
  SignalWakeGitHubError,
  SignalWakePullListLimitError,
} from "./signal-wake-github.js";

const REPO = { owner: "KeepOak", name: "Branch-Agent" };

function pull(number: number) {
  return { number, user: { login: "a" }, head: { ref: "r", sha: "s" } };
}

describe("createSignalWakeGitHub", () => {
  it("serves the cached body on 304 and sends If-None-Match", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([pull(1)]), { status: 200, headers: { etag: '"v1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    const first = await github.listOpenPulls(REPO);
    const second = await github.listOpenPulls(REPO);
    expect(second).toEqual(first);
    const secondInit = fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined;
    const secondHeaders = new Headers(secondInit?.headers);
    expect(secondHeaders.get("If-None-Match")).toBe('"v1"');
    expect(secondHeaders.get("Authorization")).toBe("Bearer t");
  });

  it("throws a status-only error on a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 403 }));
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    await expect(github.listOpenPulls(REPO)).rejects.toBeInstanceOf(SignalWakeGitHubError);
    await expect(github.listOpenPulls(REPO)).rejects.toMatchObject({ status: 403 });
  });

  it("maps author_association and drops malformed comments", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 5, user: { login: "rev" }, body: "FIX\n- x", author_association: "MEMBER" },
          { id: "not-a-number", body: 3 },
        ]),
        { status: 200, headers: { etag: '"c"' } },
      ),
    );
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    expect(await github.listComments(REPO, 4)).toEqual([
      { id: 5, authorLogin: "rev", body: "FIX\n- x", authorAssociation: "MEMBER" },
    ]);
  });

  it("pages through open PRs and keeps an ETag per page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => pull(i + 1));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstPage), { status: 200, headers: { etag: '"p1"' } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([pull(101)]), { status: 200, headers: { etag: '"p2"' } }),
      );
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    const pulls = await github.listOpenPulls(REPO);
    expect(pulls).toHaveLength(101);
    expect(pulls.at(-1)?.number).toBe(101);
    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("page=1");
    expect(urls[1]).toContain("page=2");
  });

  it("refuses a partial list past the page cap instead of cutting it silently", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => pull(i + 1));
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify(fullPage), { status: 200 }));
    const github = createSignalWakeGitHub({
      fetchImpl: fetchImpl as typeof fetch,
      token: "t",
      maxPullPages: 2,
    });
    await expect(github.listOpenPulls(REPO)).rejects.toBeInstanceOf(SignalWakePullListLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
