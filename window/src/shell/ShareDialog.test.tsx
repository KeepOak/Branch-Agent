// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ShareDialog } from "./ShareDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const LIST = {
  role: "owner",
  allowedVisibilities: ["shared", "read-only", "draft"],
  owner: { id: "me", displayName: "Me" },
  members: [],
  identities: [{ id: "me" }],
};

async function renderShare(request: (method: string, params?: unknown) => Promise<unknown>, title = "Test User") {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <ShareDialog
      engine={{ request } as unknown as WindowEngine}
      sessionKey="agent:main:main"
      title={title}
      publicLink={(token) => `http://127.0.0.1/share/${token}`}
      onCopy={() => undefined}
      onClose={() => undefined}
    />,
  ));
  return host;
}

it("When session.members.list rejects, the dialog shows the error text and a Try again button that reloads.", async () => {
  let fail = true;
  const request = vi.fn(async (method: string) => {
    if (method === "session.members.list") {
      if (fail) throw new Error("unknown session: agent:main:main");
      return LIST;
    }
    return { session: { visibility: "read-only", label: "October roadmap" } };
  });
  const host = await renderShare(request);
  expect(host.textContent).toContain("This conversation hasn't started yet.");
  expect(host.textContent).not.toContain("unknown session");
  const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");
  expect(retry).toBeTruthy();
  expect(host.querySelector('[role="radiogroup"]')).toBeNull();
  fail = false;
  await act(async () => retry!.click());
  expect(host.textContent).toContain("Everyone else on this Branch");
  expect(host.querySelector('[role="radiogroup"]')).toBeTruthy();
  expect(request.mock.calls.filter(([method]) => method === "session.members.list")).toHaveLength(2);
});

it("While loading, a loading line shows; after a successful load, the visibility controls render (today's behaviour).", async () => {
  let release!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const request = vi.fn(async (method: string) => {
    if (method === "session.members.list") return pending;
    return { session: { visibility: "shared", displayName: "Research notes" } };
  });
  const host = await renderShare(request, "Researcher");
  expect(host.textContent).toContain("Loading…");
  expect(host.querySelector('[role="radiogroup"]')).toBeNull();
  expect(host.querySelector("[data-testid=share-dialog]")?.getAttribute("aria-label")).toBe("Share Researcher");
  await act(async () => release(LIST));
  expect(host.textContent).not.toContain("Loading…");
  expect(host.textContent).toContain("Everyone else on this Branch");
  expect(host.textContent).toContain("May read it");
  expect(host.textContent).toContain("May write in it");
  expect(host.querySelector('[role="radiogroup"]')).toBeTruthy();
  expect(host.querySelector("[data-testid=share-dialog]")?.getAttribute("aria-label")).toBe("Share Research notes");
});
