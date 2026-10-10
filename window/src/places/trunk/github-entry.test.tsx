// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToolsGitHubStatusResult } from "@branch/gateway-protocol";
import type { WindowEngine } from "../../connect/engine";
import { KitProvider } from "../settings/kit";
import { TrunkEditor } from "./TrunkEditor";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: () => <span /> }));
const report = { saved() {}, saving() {}, failed() {} };
const identity: NonNullable<ToolsGitHubStatusResult["effective"]> = { source: "agent-override", credentialKind: "managed-oauth", credentialState: "available", account: { login: "birch-github" }, gitAuthor: { name: "Birch", email: null }, evidence: "github-api", accessExpiresAtMs: null, refreshState: "not_applicable", oauthScopes: ["repo"], repositoryGrants: "unknown" };
const status: ToolsGitHubStatusResult = { agentId: "birch", selectedScope: "agent", selected: { scope: "agent", configured: true, identity }, effective: identity };
const device = { requestId: "github-device-birch", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresInMs: 900000, pollAfterMs: 60000 };
let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
function fixture(scopes = ["operator.admin"]) {
  let inherited = false;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", identity: { name: "Oak" } }, { id: "birch", identity: { name: "Birch" } }] };
    if (method === "config.get") return { hash: inherited ? "h2" : "h1", valid: true, config: { agents: { entries: { birch: {} } } } };
    if (method === "models.list") return { models: [] };
    if (method === "node.list") return { nodes: [] };
    if (method === "tools.github.status") return status;
    if (method === "tools.github.authorize.start") return device;
    if (method === "tools.github.authorize.cancel") return { cancelled: true };
    if (method === "tools.github.configure") { inherited = true; return { ...status, selected: { scope: "agent", configured: false, identity: null }, effective: { ...identity, source: "system-configured", account: { login: "shared-github" } } }; }
    return { ok: true };
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], scopes, agentId: "oak", sessionKey: "agent:oak:main", onEvent: () => () => {} };
  return { engine, request };
}
async function mount(engine: WindowEngine, scope: string | null = null, onClose = vi.fn()) {
  await act(async () => root.render(<KitProvider scope={scope} level={1} report={report}><TrunkEditor engine={engine} agentId="birch" level="advanced" tab="may" onClose={onClose} /></KitProvider>));
}
function button(text: string) { const found = Array.from(document.body.querySelectorAll("button")).find(b => b.textContent === text); expect(found).toBeTruthy(); return found!; }
async function click(text: string) { await act(async () => button(text).click()); }

it.each([null, "oak"])("pins mounted editor GitHub reads and sign-in to edited Birch, ignoring Settings scope %s", async scope => {
  const { engine, request } = fixture(); await mount(engine, scope);
  expect(request).toHaveBeenCalledWith("tools.github.status", { agentId: "birch", selectedScope: "agent" });
  expect(document.body.textContent).toContain("@birch-github");
  expect(document.body.textContent).toContain("GitHub connection changes save immediately for Birch");
  expect(button("Save").disabled).toBe(true);
  await click("Change account");
  expect(request).toHaveBeenCalledWith("tools.github.authorize.start", { agentId: "birch", scope: "agent" });
  expect(document.body.textContent).toContain(device.userCode);
  await click("Look");
  expect(request).toHaveBeenCalledWith("tools.github.authorize.cancel", { requestId: device.requestId });
  expect(request.mock.calls.some(([method]) => method === "tools.github.authorize.poll")).toBe(false);
});

it("inherits immediately for Birch without saving other editor drafts when cancelled", async () => {
  const { engine, request } = fixture(); const closed = vi.fn(); await mount(engine, null, closed);
  await act(async () => (document.body.querySelector('[aria-label="Use the browser"]') as HTMLButtonElement).click());
  expect(button("Save").disabled).toBe(false);
  await click("Use shared account");
  expect(request).toHaveBeenCalledWith("tools.github.configure", { agentId: "birch", scope: "agent", mode: "inherit" });
  expect(document.body.textContent).toContain("@shared-github");
  await click("Cancel"); expect(closed).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.some(([method]) => method === "agents.update" || method === "config.patch")).toBe(false);
});

it("saves ordinary editor changes against fresh revision after an immediate GitHub change", async () => {
  const { engine, request } = fixture(); await mount(engine);
  await act(async () => (document.body.querySelector('[aria-label="Use the browser"]') as HTMLButtonElement).click());
  await click("Use shared account"); await click("Save");
  const patch = request.mock.calls.find(([method]) => method === "config.patch");
  expect(patch).toBeTruthy();
  expect(patch).toEqual(["config.patch", { baseHash: "h2", raw: JSON.stringify({ agents: { entries: { birch: { toolsets: { browser: false } } } } }) }]);
});

it("keeps edited-Trunk identity visible but blocks all GitHub mutations for read-only operators", async () => {
  const { engine, request } = fixture(["operator.read"]); await mount(engine, "oak");
  expect(document.body.textContent).toContain("@birch-github");
  expect(button("Change account").disabled).toBe(true); expect(button("Use shared account").disabled).toBe(true);
  await click("Change account"); await click("Use shared account"); await click("Refresh");
  expect(request.mock.calls.some(([method]) => method === "tools.github.configure" || method === "tools.github.authorize.start")).toBe(false);
  expect(request.mock.calls.filter(([method]) => method === "tools.github.status")).toHaveLength(2);
});
