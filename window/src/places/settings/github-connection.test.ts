import { afterEach, expect, it, vi } from "vitest";
import { GitHubConnection } from "./github-connection";
import type { WindowEngine } from "../../connect/engine";
import type { ToolsGitHubStatusResult } from "@branch/gateway-protocol";
export const githubStatus: ToolsGitHubStatusResult = {
  agentId: "oak", selectedScope: "agent", selected: { scope: "agent", configured: true, identity: null },
  effective: { source: "agent-override", credentialKind: "managed-oauth", credentialState: "available", account: { login: "oak" }, gitAuthor: { name: "Oak", email: null }, evidence: "github-api", accessExpiresAtMs: 100000, refreshState: "available", oauthScopes: ["repo", "read:user"], repositoryGrants: "unknown" },
};
const device = { requestId: "github-device-123", userCode: "ABCD-EFGH", verificationUri: "https://github.com/login/device", expiresInMs: 900000, pollAfterMs: 1000 };
const engine = (request: ReturnType<typeof vi.fn>): WindowEngine => ({ request: request as WindowEngine["request"], scopes: ["operator.admin"], sessionKey: null, agentId: "oak", onEvent: () => () => {} });
afterEach(() => vi.useRealTimers());
it("uses actual per-Trunk status and authorization contracts and server polling cadence", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValueOnce(githubStatus).mockResolvedValueOnce(device).mockResolvedValueOnce({ status: "slow_down", retryAfterMs: 5000 }).mockResolvedValueOnce({ status: "success", githubStatus });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {});
  await c.refresh(); await c.start(); await vi.advanceTimersByTimeAsync(1000);
  expect(c.view.phase).toBe("slow_down"); await vi.advanceTimersByTimeAsync(4999); expect(request).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(request.mock.calls).toEqual([["tools.github.status", { agentId: "oak", selectedScope: "agent" }], ["tools.github.authorize.start", { agentId: "oak", scope: "agent" }], ["tools.github.authorize.poll", { requestId: device.requestId }], ["tools.github.authorize.poll", { requestId: device.requestId }]]);
  expect(c.view.status).toEqual(githubStatus); expect(c.view.device).toBeNull(); expect(c.view.busy).toBe(false); c.dispose();
});
it("prevents duplicate starts and cancels a request that arrives after owner unmount", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ cancelled: true });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {});
  const start = c.start(); await c.start(); expect(request).toHaveBeenCalledTimes(1); c.dispose(); finish(device); await start;
  expect(request).toHaveBeenLastCalledWith("tools.github.authorize.cancel", { requestId: device.requestId });
});
it("retains cancellation intent while start is in flight", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ cancelled: true });
  const c = new GitHubConnection(engine(request), "oak", "system", () => {});
  const start = c.start(); await c.cancel(); finish(device); await start;
  expect(request).toHaveBeenLastCalledWith("tools.github.authorize.cancel", { requestId: device.requestId }); expect(c.view.busy).toBe(false); c.dispose();
});
it("continues polling when cancellation loses to authorization completion", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValueOnce(device).mockResolvedValueOnce({ cancelled: false }).mockResolvedValueOnce({ status: "success", githubStatus });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {}); await c.start(); await c.cancel();
  expect(c.view.phase).toBe("finishing"); await vi.advanceTimersByTimeAsync(1000); expect(c.view.status).toEqual(githubStatus); c.dispose();
});
it.each(["expired", "access_denied", "incorrect_device_code"])("shows %s instead of inventing a connected account", async status => {
  vi.useFakeTimers(); const request = vi.fn().mockResolvedValueOnce(device).mockResolvedValueOnce({ status });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {}); await c.start(); await vi.advanceTimersByTimeAsync(1000);
  expect(c.view.phase).toBe(status); expect(c.view.status).toBeNull(); expect(c.view.busy).toBe(false); expect(c.view.error).toContain(status.replaceAll("_", " ")); c.dispose();
});
it("does not clear selected identity on failed removal, and uses inherit not token configuration", async () => {
  const request = vi.fn().mockResolvedValueOnce(githubStatus).mockRejectedValueOnce(new Error("Could not save"));
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {}); await c.refresh(); await c.inherit();
  expect(c.view.status).toEqual(githubStatus); expect(c.view.error).toBe("Could not save"); expect(request).toHaveBeenLastCalledWith("tools.github.configure", { scope: "agent", agentId: "oak", mode: "inherit" }); c.dispose();
});
it("stale status reads cannot overwrite a successful authorization", async () => {
  vi.useFakeTimers(); let finish!: (value: unknown) => void;
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(device).mockResolvedValueOnce({ status: "success", githubStatus });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {}); const read = c.refresh(); await c.start(); await vi.advanceTimersByTimeAsync(1000); finish({ ...githubStatus, effective: { ...githubStatus.effective, account: null } }); await read;
  expect(c.view.status).toEqual(githubStatus); c.dispose();
});
it("does not shorten server-directed retry backoff to one minute", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValueOnce(device).mockResolvedValueOnce({ status: "network_error", retryAfterMs: 120000 }).mockResolvedValueOnce({ status: "success", githubStatus });
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {});
  await c.start(); await vi.advanceTimersByTimeAsync(1000); await vi.advanceTimersByTimeAsync(119999);
  expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(c.view.status).toEqual(githubStatus); c.dispose();
});
it("treats a status without a selected scope as not known yet", async () => {
  const request = vi.fn().mockResolvedValueOnce({});
  const c = new GitHubConnection(engine(request), "oak", "agent", () => {}); await c.refresh();
  expect(c.view.status).toBeNull(); expect(c.view.phase).toBe("ready"); c.dispose();
});
