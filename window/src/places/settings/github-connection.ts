// Adapted from engine/ui/src/features/github-connections/github-identity-controller-authorization.ts.
// The engine owns credentials, polling intervals, identity replacement and expiry.
import type { WindowEngine } from "../../connect/engine";
import type { ToolsGitHubStatusResult, ToolsGitHubAuthorizeStartResult, ToolsGitHubAuthorizePollResult } from "@branch/gateway-protocol";

export type GitHubView = { status: ToolsGitHubStatusResult | null; device: ToolsGitHubAuthorizeStartResult | null; phase: string; error: string | null; busy: boolean; expiresAt: number | null };
/** A status without a selected scope is unreadable; treat it as not yet known. */
const readable = (status: ToolsGitHubStatusResult | null | undefined): ToolsGitHubStatusResult | null => (status && typeof status === "object" && status.selected ? status : null);
const initial = (): GitHubView => ({ status: null, device: null, phase: "loading", error: null, busy: false, expiresAt: null });
export class GitHubConnection {
  view = initial();
  private retired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cancelRequested = false;
  private cancelling = false;
  private reading = 0;
  private engine: WindowEngine;
  private agentId: string;
  private scope: "agent" | "system";
  private changed: () => void;
  constructor(engine: WindowEngine, agentId: string, scope: "agent" | "system", changed: () => void) {
    this.engine = engine; this.agentId = agentId; this.scope = scope; this.changed = changed;
  }
  private update(next: Partial<GitHubView>) { if (!this.retired) { this.view = { ...this.view, ...next }; this.changed(); } }
  private fail(error: unknown) { this.update({ error: error instanceof Error ? error.message : "GitHub request failed" }); }
  async refresh() {
    if (this.view.busy || this.retired) return;
    const revision = ++this.reading;
    this.update({ phase: "loading", error: null });
    try {
      const status = await this.engine.request<ToolsGitHubStatusResult>("tools.github.status", { agentId: this.agentId, selectedScope: this.scope });
      if (revision === this.reading) this.update({ status: readable(status), phase: "ready" });
    } catch (error) { if (revision === this.reading) { this.fail(error); this.update({ phase: "ready" }); } }
  }
  async start() {
    if (this.view.busy || this.retired) return;
    ++this.reading;
    this.cancelRequested = false;
    this.update({ busy: true, phase: "starting", error: null });
    try {
      const device = await this.engine.request<ToolsGitHubAuthorizeStartResult>("tools.github.authorize.start", { agentId: this.agentId, scope: this.scope });
      if (this.retired) { await this.engine.request("tools.github.authorize.cancel", { requestId: device.requestId }); return; }
      this.update({ device, expiresAt: Date.now() + device.expiresInMs, phase: "code" });
      if (this.cancelRequested) await this.cancel(); else this.schedule(device.pollAfterMs);
    } catch (error) { this.fail(error); this.update({ busy: false, phase: "failed" }); }
  }
  private schedule(delay: number) {
    if (this.retired) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.poll(); }, Math.max(1, Math.min(delay, 2_147_483_647)));
  }
  private async poll() {
    const device = this.view.device;
    if (!device || this.retired) return;
    try {
      const result = await this.engine.request<ToolsGitHubAuthorizePollResult>("tools.github.authorize.poll", { requestId: device.requestId });
      if (this.retired || this.view.device !== device) return;
      if (result.status === "success") {
        this.update({ status: result.githubStatus, device: null, busy: false, phase: "ready", error: null });
      } else if ("retryAfterMs" in result) {
        this.update({ phase: result.status, error: result.status === "network_error" ? "Connection interrupted. Trying again…" : null });
        this.schedule(result.retryAfterMs);
      } else {
        this.update({ device: null, busy: false, phase: result.status, error: result.status === "failed" ? `Authorization failed: ${result.reason.replaceAll("_", " ")}` : `Authorization ${result.status.replaceAll("_", " ")}. Try connecting again.` });
      }
    } catch (error) { if (this.view.device === device) { this.fail(error); this.schedule(device.pollAfterMs); } }
  }
  async cancel() {
    this.cancelRequested = true;
    const device = this.view.device;
    if (!device || this.retired || this.cancelling) return;
    this.cancelling = true;
    this.update({ phase: "cancelling", error: null });
    try {
      const result = await this.engine.request<{ cancelled: boolean }>("tools.github.authorize.cancel", { requestId: device.requestId });
      if (this.view.device !== device) return;
      if (result.cancelled) { if (this.timer) clearTimeout(this.timer); this.update({ device: null, busy: false, phase: "ready" }); }
      else { this.update({ phase: "finishing" }); this.schedule(device.pollAfterMs); }
    } catch (error) { if (this.view.device === device) { this.fail(error); this.update({ phase: "cancel_error" }); this.schedule(device.pollAfterMs); } }
    finally { this.cancelling = false; }
  }
  async inherit() {
    if (this.view.busy || this.retired) return;
    ++this.reading;
    this.update({ busy: true, phase: "saving", error: null });
    try {
      const status = await this.engine.request<ToolsGitHubStatusResult>("tools.github.configure", { scope: this.scope, agentId: this.agentId, mode: "inherit" });
      this.update({ status: readable(status), phase: "ready" });
    } catch (error) { this.fail(error); }
    finally { this.update({ busy: false, phase: "ready" }); }
  }
  dispose() {
    this.retired = true; ++this.reading;
    if (this.timer) clearTimeout(this.timer);
    if (this.view.device) void this.engine.request("tools.github.authorize.cancel", { requestId: this.view.device.requestId }).catch(() => {});
  }
}
