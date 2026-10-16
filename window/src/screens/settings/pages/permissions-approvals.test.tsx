// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { ApprovalsRow } from "./permissions-approvals";

const level = vi.hoisted(() => ({ value: 1 }));
vi.mock("../SettingsFrame", async (real) => ({ ...(await real<object>()), useLevel: () => [level.value, () => undefined] }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  level.value = 1;
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

const pending = {
  id: "ap1", sessionKey: "agent:scout:main", agentId: "scout",
  request: { command: "npm test", cwd: "/work/site", host: "gateway", sessionKey: "agent:scout:main", agentId: "scout", allowedDecisions: ["allow-once", "allow-always", "deny"] },
};
function engine() {
  const request = vi.fn(async (method: string) => {
    if (method === "exec.approval.list") return { approvals: [pending] };
    if (method === "approval.history") return { items: [] };
    if (method === "exec.approval.grants.list") return { grants: [] };
    return {};
  });
  const methods = ["exec.approval.list", "exec.approval.resolve", "approval.history", "exec.approval.grants.list"];
  return { request, engine: { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine };
}
const openButton = () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Open") ?? null;

it("the Approvals row is closed by default: its record is not drawn inline", async () => {
  const { engine: e } = engine();
  await act(async () => root.render(<ApprovalsRow engine={e} />));
  await flush();
  expect(openButton()).not.toBeNull();
  expect(host.querySelector('[data-testid="r1-ask-history"]')).toBeNull();
  expect(host.textContent).not.toContain("Standing permissions");
});

it("Open shows the Approvals dialog with Waiting now, Standing permissions and Answered, and Allow answers from it", async () => {
  const { engine: e, request } = engine();
  await act(async () => root.render(<ApprovalsRow engine={e} />));
  await flush();
  await act(async () => openButton()!.click());
  await flush();
  const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Approvals"]');
  expect(dialog).not.toBeNull();
  const heads = [...dialog!.querySelectorAll("h3")].map(h => h.textContent);
  expect(heads).toEqual(["Waiting now", "Standing permissions", "Answered"]);
  expect(dialog!.textContent).toContain("npm test");
  const allow = [...dialog!.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Allow")!;
  await act(async () => allow.click());
  await flush();
  expect(request).toHaveBeenCalledWith("exec.approval.resolve", expect.objectContaining({ id: "ap1", decision: "allow-once" }));
});

it("below the advanced level the row is not drawn at all", async () => {
  level.value = 0;
  const { engine: e } = engine();
  await act(async () => root.render(<ApprovalsRow engine={e} />));
  await flush();
  expect(openButton()).toBeNull();
});
