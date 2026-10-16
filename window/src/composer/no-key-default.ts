import type { WindowEngine } from "./engine";

/** Shown while a free local model is being set up. Chat stays open; send waits until it answers. */
export const FREE_MODEL_READY = "Getting a free model ready…";
/** Suggestion, never a requirement. */
export const ACCOUNT_FASTER = "Connecting an account makes answers smarter and faster.";
export const NO_KEY_DEFAULT_KIND = "no-key-default";

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const attempted = new WeakSet<object>();
const inflight = new WeakMap<object, Promise<boolean>>();

/** Ask the engine to use a free local model when none is connected. Safe to call more than once. */
export function ensureNoKeyDefault(engine: WindowEngine): Promise<boolean> {
  const existing = inflight.get(engine);
  if (existing) return existing;
  if (attempted.has(engine)) return Promise.resolve(false);
  attempted.add(engine);
  const run = (async () => {
    try {
      const result = rec(
        await engine.request("branch.setup.activate", {
          kind: NO_KEY_DEFAULT_KIND,
          ...(engine.agentId ? { agentId: engine.agentId } : {}),
        }),
      );
      return result.ok === true;
    } catch {
      return false;
    }
  })();
  inflight.set(engine, run);
  void run.finally(() => {
    if (inflight.get(engine) === run) inflight.delete(engine);
  });
  return run;
}

export function resetNoKeyDefaultForTests(engine?: object): void {
  if (engine) {
    attempted.delete(engine);
    inflight.delete(engine);
  }
}
