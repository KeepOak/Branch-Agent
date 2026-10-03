// The composer's view of the engine: the shared handle (connect/engine.ts) plus small readers for its loose JSON.
export type { SendExtras, WindowEngine } from "../connect/engine";

export type Rec = Record<string, unknown>;

export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

/** The words of an engine error, for a line the person reads. */
export function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  const r = rec(error);
  return str(r.message) || String(error);
}

/** The Trunk of an agent-scoped key ("agent:<id>:..."), as the engine's routing/session-key.ts reads it. */
export function agentOf(sessionKey: string | null | undefined): string | undefined {
  const m = /^agent:([^:]+):/.exec(sessionKey ?? "");
  return m ? m[1] : undefined;
}

export const ADMIN_SCOPE = "operator.admin";

export function isAdmin(scopes: readonly string[]): boolean {
  return scopes.includes(ADMIN_SCOPE);
}
