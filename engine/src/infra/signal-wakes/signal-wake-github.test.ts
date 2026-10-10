import { describe, expect, it, vi } from "vitest";
import { createSignalWakeGitHub, SignalWakeGitHubError } from "./signal-wake-github.js";

const REPO = { owner: "KeepOak", name: "Branch-Agent" };

describe("createSignalWakeGitHub", () => {
  it("serves the cached body on 304 and sends If-None-Match", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ number: 1, user: { login: "a" }, head: { ref: "r", sha: "s" } }]),
          {
            status: 200,
            headers: { etag: '"v1"' },
          },
        ),
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

  it("drops malformed comments and keeps well-formed ones", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 5, user: { login: "rev" }, body: "FIX\n- x" },
          { id: "not-a-number", body: 3 },
        ]),
        { status: 200, headers: { etag: '"c"' } },
      ),
    );
    const github = createSignalWakeGitHub({ fetchImpl: fetchImpl as typeof fetch, token: "t" });
    expect(await github.listComments(REPO, 4)).toEqual([
      { id: 5, authorLogin: "rev", body: "FIX\n- x" },
    ]);
  });
});
