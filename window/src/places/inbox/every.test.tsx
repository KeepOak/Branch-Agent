// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Every } from "./Every";
import type { HistoryData } from "./History";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const data: HistoryData = { sessions: [], runs: [], profiles: [], self: "", agents: { defaultId: "", list: [] }, errors: [] };
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });
const engineOf = (request: WindowEngine["request"]): WindowEngine => ({ request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.read"] });

it("hides working copies from the previous connection while the replacement is loading", async () => {
  const first = engineOf(vi.fn().mockResolvedValue({ worktrees: [{ id: "old", name: "Old copy", branch: "old", path: "/old", ownerKind: "session", ownerId: "old-session" }] }));
  let resolve!: (value: unknown) => void;
  const request = vi.fn(() => new Promise(done => { resolve = done; }));
  const second = engineOf(request as WindowEngine["request"]);
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const render = (engine: WindowEngine) => <Every engine={engine} data={data} level="technical" open={() => {}} />;
  await act(async () => root!.render(render(first)));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Working copies")!.click());
  expect(host.textContent).toContain("Old copy");
  await act(async () => root!.render(render(second)));
  expect(host.textContent).not.toContain("Old copy");
  expect(host.textContent).toContain("Reading working copies…");
  expect(host.querySelector(".ib-list button")).toBeNull();
  await act(async () => resolve({ worktrees: [{ id: "new", name: "New copy", branch: "new", path: "/new" }] }));
  expect(request).toHaveBeenCalledWith("worktrees.list", {});
  expect(host.textContent).toContain("New copy");
});
