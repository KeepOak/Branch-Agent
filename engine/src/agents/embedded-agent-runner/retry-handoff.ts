import { isAgentEventLifecycleGenerationCurrent } from "../../infra/agent-events.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";

export type HandoffRetryWait = {
  runId: string;
  sessionId: string;
  sessionKey: string;
  lifecycleGeneration: string;
  deadlineAtMs?: number;
  isCurrent: () => boolean;
  abort: () => void;
};

type ParkRetryWait = (wait: HandoffRetryWait) => Promise<void>;
const state = resolveGlobalSingleton<{
  waits: Set<HandoffRetryWait>;
  park?: ParkRetryWait;
  activation?: Promise<boolean>;
  prepared: Map<HandoffRetryWait, Promise<void>>;
  pending: Map<HandoffRetryWait, Promise<void>>;
}>(Symbol.for("branch.retryHandoff"), () => ({
  waits: new Set(),
  prepared: new Map(),
  pending: new Map(),
}));

function park(wait: HandoffRetryWait, persist: ParkRetryWait): Promise<void> {
  const previous = state.pending.get(wait);
  if (previous) {
    return previous;
  }
  const activation = state.activation;
  const prepared = Promise.resolve().then(async () => {
    if (!wait.isCurrent()) {
      return;
    }
    await persist(wait);
  });
  const pending = prepared.then(async () => {
    if ((await activation) && wait.isCurrent()) {
      wait.abort();
    }
  });
  state.prepared.set(wait, prepared);
  state.pending.set(wait, pending);
  void pending.catch(() => {});
  return pending;
}

/** Quiet boundaries have no in-flight model operation; persist before their owner leaves. */
export function registerHandoffRetryWait(owner: HandoffRetryWait) {
  let active = true;
  const wait = {
    ...owner,
    isCurrent: () =>
      active &&
      isAgentEventLifecycleGenerationCurrent(owner.lifecycleGeneration) &&
      owner.isCurrent(),
  };
  state.waits.add(wait);
  if (state.park) {
    void park(wait, state.park);
  }
  return {
    finish(): Promise<void> | undefined {
      // The timer can expire while the durable handoff is committing. Do not start another attempt then.
      const release = () => {
        active = false;
        state.waits.delete(wait);
        state.prepared.delete(wait);
        state.pending.delete(wait);
      };
      const pending = state.pending.get(wait);
      if (!pending) {
        release();
        return undefined;
      }
      // A failed persistence attempt leaves the original owner running.
      return pending.catch(() => {}).finally(release);
    },
    release() {
      active = false;
      state.waits.delete(wait);
      state.prepared.delete(wait);
      if (!state.pending.has(wait)) {
        return;
      }
      void state.pending
        .get(wait)!
        .finally(() => state.pending.delete(wait))
        .catch(() => {});
    },
  };
}

/** Keeps parking later retries as already-admitted steps reach their next quiet boundary. */
export function beginRetryWaitHandoff(persist: ParkRetryWait) {
  if (state.park) {
    throw new Error("Retry wait handoff is already active");
  }
  let activate!: (committed: boolean) => void;
  state.activation = new Promise<boolean>((resolve) => {
    activate = resolve;
  });
  state.park = persist;
  return {
    ready: Promise.all(
      [...state.waits].map((wait) => {
        void park(wait, persist);
        return state.prepared.get(wait)!;
      }),
    ).then(() => {}),
    commit() {
      activate(true);
    },
    stop() {
      if (state.park === persist) {
        activate(false);
        state.park = undefined;
        state.activation = undefined;
      }
    },
  };
}
