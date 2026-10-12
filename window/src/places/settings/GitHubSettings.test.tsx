// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { GitHubSettings } from "./GitHubSettings";
import { KitProvider } from "./kit";
import type { ToolsGitHubStatusResult } from "@branch/gateway-protocol";
const status: ToolsGitHubStatusResult = { agentId: "oak", selectedScope: "agent", selected: { scope: "agent", configured: true, identity: null }, effective: { source: "agent-override", credentialKind: "managed-oauth", credentialState: "available", account: { login: "oak" }, gitAuthor: { name: "Oak", email: null }, evidence: "github-api", accessExpiresAtMs: 100000, refreshState: "expired", oauthScopes: ["repo", "read:user"], repositoryGrants: "unknown" } };
const device = { requestId: "github-device-123", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresInMs: 900000, pollAfterMs: 1000 };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const report = { saved() {}, saving() {}, failed() {} };
const engine = (request: ReturnType<typeof vi.fn>, scopes = ["operator.admin"]): WindowEngine => ({ request: request as WindowEngine["request"], scopes, sessionKey: null, agentId: "oak", onEvent: () => () => {} });
const view = (e: WindowEngine, scope: string | null = "oak") => <KitProvider scope={scope} level={0} report={report}><GitHubSettings engine={e} /></KitProvider>;
const click = async (label: string) => act(async () => { const b = Array.from(host.querySelectorAll("button")).find(b => b.textContent === label); expect(b).toBeTruthy(); b!.click(); });
it("renders real identity, scopes, expiry and external revocation without token fields", async () => {
  const request = vi.fn(async (method: string) => method === "tools.github.status" ? status : { config: {}, hash: "one" });
  await act(async () => root.render(view(engine(request))));
  expect(request).toHaveBeenCalledWith("tools.github.status", { agentId: "oak", selectedScope: "agent" });
  expect(host.textContent).toContain("@oak"); expect(host.textContent).toContain("repo, read:user"); expect(host.textContent).toContain("Refresh: expired"); expect(host.querySelector("input")).toBeNull();
  expect(host.querySelector('a[href="https://github.com/settings/applications"]')).not.toBeNull();
});
it("connects using device authorization and refreshes shared config after polling success", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (method: string) => {
    if (method === "tools.github.status") return status;
    if (method === "tools.github.authorize.start") return device;
    if (method === "tools.github.authorize.poll") return { status: "success", githubStatus: { ...status, effective: { ...status.effective, account: { login: "new-oak" } } } };
    return { config: {}, hash: "one" };
  });
  await act(async () => root.render(view(engine(request)))); const reads = request.mock.calls.filter(c => c[0] === "config.get").length;
  await click("Change account"); expect(host.textContent).toContain(device.userCode); expect(host.querySelector('a[href="https://github.com/login/device"]')).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(host.textContent).toContain("@new-oak"); expect(host.textContent).not.toContain(device.userCode); expect(request.mock.calls.filter(c => c[0] === "config.get").length).toBeGreaterThan(reads);
});
it("removes only this Trunk’s override through the real inherit endpoint", async () => {
  const request = vi.fn(async (method: string) => method === "tools.github.configure" ? { ...status, selected: { scope: "agent", configured: false, identity: null }, effective: { ...status.effective, source: "system-detected" } } : method === "tools.github.status" ? status : { config: {}, hash: "one" });
  await act(async () => root.render(view(engine(request)))); await click("Use shared account");
  expect(request).toHaveBeenCalledWith("tools.github.configure", { agentId: "oak", scope: "agent", mode: "inherit" }); expect(host.textContent).not.toContain("Use shared account"); expect(host.textContent).toContain("This computer’s account");
});
it("cancels old ownership and ignores delayed status when Settings for changes", async () => {
  vi.useFakeTimers(); const request = vi.fn(async (method: string, params?: unknown) => method === "tools.github.authorize.start" ? device : method === "tools.github.authorize.cancel" ? { cancelled: true } : method === "tools.github.status" ? { ...status, agentId: (params as {agentId:string}).agentId } : { config: {}, hash: "one" });
  const e = engine(request); await act(async () => root.render(view(e))); await click("Change account");
  await act(async () => root.render(view(e, "pine"))); expect(request).toHaveBeenCalledWith("tools.github.authorize.cancel", { requestId: device.requestId }); expect(request).toHaveBeenCalledWith("tools.github.status", { agentId: "pine", selectedScope: "agent" }); expect(host.textContent).not.toContain(device.userCode);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(request.mock.calls.filter(c => c[0] === "tools.github.authorize.poll")).toHaveLength(0);
});
it("read-only operators see actual state with no enabled mutation controls", async () => {
  const request = vi.fn(async (method: string) => method === "tools.github.status" ? status : { config: {}, hash: "one" });
  await act(async () => root.render(view(engine(request, ["operator.read"]))));
  expect(host.textContent).toContain("@oak"); for (const b of host.querySelectorAll("button")) if (b.textContent !== "Refresh") expect(b.disabled).toBe(true);
});
it("shared settings display the shared identity, not the active Trunk override", async () => {
  const shared = { ...status.effective, source: "system-configured" as const, account: { login: "shared-oak" } };
  const request = vi.fn(async (method: string) => method === "tools.github.status" || method === "tools.github.configure" ? { ...status, selectedScope: "system", selected: { scope: "system", configured: true, identity: shared } } : { config: {}, hash: "one" });
  await act(async () => root.render(view(engine(request), null)));
  expect(host.textContent).toContain("@shared-oak"); expect(host.textContent).not.toContain("This Trunk’s account");
  await click("Use computer’s account");
  expect(request).toHaveBeenCalledWith("tools.github.configure", { agentId: "oak", scope: "system", mode: "inherit" });
});
it("failed status reads leave an actionable error instead of an endless checking state", async () => {
  const request = vi.fn(async () => { throw new Error("Gateway unavailable"); });
  await act(async () => root.render(view(engine(request))));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Gateway unavailable");
  expect(host.textContent).not.toContain("Reading connection");
  const refresh = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Refresh");
  expect(refresh?.disabled).toBe(false);
});
