// A conversation this window starts is "May read it" for everyone else on this Branch (UI audit SH2). The engine
// treats a session with no visibility as "shared" (engine/src/gateway/session-sharing-policy.ts
// resolveSessionVisibility), the most permissive level, so every sessions.create from here names the safe one.
// People added one by one in Share… can still write in it.
import type { HelloOk } from "@branch/gateway-client/browser";

/** The level everyone else on this Branch gets on a new conversation. */
export const SAFE_VISIBILITY = "read-only" as const;

/** True when the engine allows the safe level (hello.policy.allowedSessionVisibilities). */
export function safeVisibilityAllowed(allowed: readonly string[] | undefined): boolean {
  return Array.isArray(allowed) && allowed.includes(SAFE_VISIBILITY);
}

/** The level a draft opens to when published: "May read it" when the engine allows it, else "May write in it". */
export function publishedVisibility(allowed: readonly string[]): "read-only" | "shared" {
  return safeVisibilityAllowed(allowed) ? SAFE_VISIBILITY : "shared";
}

/** Adds visibility "read-only" to a sessions.create for a new conversation that names no visibility. */
export function withSafeVisibility(method: string, params: unknown, hello: Pick<HelloOk, "policy"> | null): unknown {
  if (method !== "sessions.create" || !params || typeof params !== "object" || Array.isArray(params)) return params;
  const record = params as Record<string, unknown>;
  // An existing key keeps its own visibility: the engine refuses a different one on a session that already exists.
  if (record.visibility !== undefined || record.key !== undefined) return params;
  if (!safeVisibilityAllowed(hello?.policy.allowedSessionVisibilities)) return params;
  return { ...record, visibility: SAFE_VISIBILITY };
}
