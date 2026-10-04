import { randomUUID } from "node:crypto";

export type UpdatePhase = "preparing" | "updating" | "reconnecting" | "complete" | "failed";
export type RendererMethod = "prepare" | "resume" | "cancel" | "policy" | "identity";
export interface RendererTarget {
  isTrusted(): boolean;
  send(channel: string, payload: unknown): void;
}
/** Only the canonical served renderer may answer. Its own gateway connection owns authorization. */
export class DesktopRendererRpc {
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly target: RendererTarget, private readonly timeoutMs = 180_000) {}
  reply(value: unknown, trusted: boolean): void {
    if (!trusted || !value || typeof value !== "object") return;
    const reply = value as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof reply.id !== "string") return;
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(reply.id);
    if (typeof reply.error === "string") pending.reject(new Error(reply.error));
    else pending.resolve(reply.result);
  }
  request(method: RendererMethod, input: unknown): Promise<unknown> {
    if (!this.target.isTrusted()) return Promise.reject(new Error("The authenticated Branch window is unavailable"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Desktop ${method} acknowledgement timed out`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.target.send("branch-desktop:update-request", { id, method, input });
    });
  }
  close(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Desktop window closed")); }
    this.pending.clear();
  }
}
