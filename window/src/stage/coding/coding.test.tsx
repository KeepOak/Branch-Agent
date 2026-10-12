// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WindowEngine } from "../../connect/engine";
import { gapBetween, parsePatch, splitRows } from "./diff";
import { ChangesTab } from "./ChangesTab";

const patch = "diff --git a/q.md b/q.md\n--- a/q.md\n+++ b/q.md\n@@ -1,3 +1,4 @@\n-Oakfield: $40\n+Oakfield: $38.50\n Brightline: $41\n+Staples: $46\n same\n@@ -20,2 +21,2 @@ ## Delivery\n-unknown\n+3 days\n";

describe("diff", () => {
  it("reads hunks with line numbers and the gap between them", () => {
    const h = parsePatch(patch);
    expect(h).toHaveLength(2);
    expect(h[0]!.lines.map((l) => l.kind)).toEqual(["del", "add", "ctx", "add", "ctx"]);
    expect(h[0]!.lines[1]).toMatchObject({ text: "Oakfield: $38.50", newNo: 1 });
    expect(h[1]!.header).toBe("## Delivery");
    expect(gapBetween(h[0]!, h[1]!)).toBe(16);
  });
  it("pairs deletions with additions for the split view", () => {
    const rows = splitRows(parsePatch(patch)[0]!);
    expect(rows[0]!.left?.text).toBe("Oakfield: $40");
    expect(rows[0]!.right?.text).toBe("Oakfield: $38.50");
  });
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function render(request: (m: string, p: any) => unknown) {
  const engine: WindowEngine = { request: vi.fn(async (m: string, p: any) => request(m, p)) as any, sessionKey: "agent:a:one", scopes: [], onEvent: () => () => {} };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<ChangesTab engine={engine} />));
  for (let i = 0; i < 4; i++) await act(async () => await Promise.resolve());
  return engine.request as ReturnType<typeof vi.fn>;
}

describe("Changes tab", () => {
  it("shows the checkout's files and how far it is ahead", async () => {
    await render((m) =>
      m === "sessions.diff"
        ? { sessionKey: "agent:a:one", root: "C:/w", branch: "fix", baseRef: "main", aheadCount: 2, commits: [{ sha: "d4e5f6a1", subject: "Compare" }], files: [{ path: "q.md", status: "modified", additions: 3, deletions: 2, patch }], additions: 3, deletions: 2 }
        : m === "sessions.github.options"
          ? { personal: null, shared: null, pendingPersonal: null, latestShared: null }
          : {},
    );
    expect(container.textContent).toContain("2 commits ahead of main");
    expect(container.textContent).toContain("q.md");
    expect(container.querySelectorAll(".ln-cd.add")).toHaveLength(3);
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open a pull request")!;
    expect(open.disabled).toBe(true);
  });
  it("says why when the folder isn't a git checkout", async () => {
    await render((m) => (m === "sessions.diff" ? { sessionKey: "agent:a:one", files: [], additions: 0, deletions: 0, unavailableReason: "not_git" } : {}));
    expect(container.textContent).toContain("This folder isn't a git checkout.");
  });
  it("opens a pull request as the shared account", async () => {
    const request = await render((m) =>
      m === "sessions.diff"
        ? { sessionKey: "agent:a:one", files: [{ path: "q.md", status: "added", additions: 1, deletions: 0 }], additions: 1, deletions: 0 }
        : m === "sessions.github.options"
          ? { personal: null, shared: { source: "system-configured", accountId: 7, login: "team-bot" }, pendingPersonal: null, latestShared: null }
          : m === "sessions.github.publish"
            ? { status: "published", requestId: "r", url: "https://github.com/o/r/pull/9", repository: "o/r", branch: "fix", headCommit: "abcdef123" }
            : {},
    );
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open a pull request as team-bot")!;
    await act(async () => open.click());
    for (let i = 0; i < 3; i++) await act(async () => await Promise.resolve());
    expect(request).toHaveBeenCalledWith("sessions.github.publish", expect.objectContaining({ sessionKey: "agent:a:one", selection: { source: "shared", expected: { source: "system-configured", accountId: 7, login: "team-bot" } } }));
    expect(container.textContent).toContain("Pull request opened");
  });
});
