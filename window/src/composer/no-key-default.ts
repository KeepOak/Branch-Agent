import { CONNECT_MODEL_ANSWERS, friendlyModelError } from "./connect-model";
import type { WindowEngine } from "./engine";

/** Shown while a free local model is being set up. Chat stays open; send waits until it answers. */
export const FREE_MODEL_READY = "Getting a free model ready…";
/** Shown when this computer cannot start a free local model. Same words as every other no-model path. */
export const FREE_MODEL_FAILED = CONNECT_MODEL_ANSWERS;
/** Suggestion, never a requirement. */
export const ACCOUNT_FASTER = "Connecting an account makes answers smarter and faster.";
export const NO_KEY_DEFAULT_KIND = "no-key-default";

export type EnsureNoKeyResult = { ok: true } | { ok: false; error: string };

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const last = new WeakMap<object, EnsureNoKeyResult>();
const inflight = new WeakMap<object, Promise<EnsureNoKeyResult>>();

function friendlyError(value: unknown): string {
  return typeof value === "string" && value.trim() ? friendlyModelError(value.trim()) : FREE_MODEL_FAILED;
}

/** Ask the engine to use a free local model when none is connected. Safe to call more than once. */
export function ensureNoKeyDefault(engine: WindowEngine): Promise<EnsureNoKeyResult> {
  const existing = inflight.get(engine);
  if (existing) return existing;
  const previous = last.get(engine);
  if (previous) return Promise.resolve(previous);
  const run = (async (): Promise<EnsureNoKeyResult> => {
    let result: EnsureNoKeyResult;
    try {
      const payload = rec(
        await engine.request("branch.setup.activate", {
          kind: NO_KEY_DEFAULT_KIND,
          ...(engine.agentId ? { agentId: engine.agentId } : {}),
        }),
      );
      result = payload.ok === true ? { ok: true } : { ok: false, error: friendlyError(payload.error) };
    } catch {
      result = { ok: false, error: FREE_MODEL_FAILED };
    }
    last.set(engine, result);
    return result;
  })();
  inflight.set(engine, run);
  void run.finally(() => {
    if (inflight.get(engine) === run) inflight.delete(engine);
  });
  return run;
}

/** Clear the last attempt so chat can ask the engine again after a failure. */
export function retryNoKeyDefault(engine: WindowEngine): Promise<EnsureNoKeyResult> {
  last.delete(engine);
  inflight.delete(engine);
  return ensureNoKeyDefault(engine);
}

export function resetNoKeyDefaultForTests(engine?: object): void {
  if (engine) {
    last.delete(engine);
    inflight.delete(engine);
  }
}
