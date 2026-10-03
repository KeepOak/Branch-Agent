import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { AsyncWorkScope } from "../../shared/async-work-scope.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../../test-utils/branch-test-state.js";
import { drainSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { disposeSessionReadContexts } from "../session-read-contexts.test-support.js";
import { deletePersistentSessionStoreRows } from "../test/persistent-session-store.test-support.js";
import { flushPendingSessionsChangedEvents } from "./session-change-event.js";

export function setupSessionMutationState() {
  let state: BranchTestState;
  beforeAll(async () => {
    state = await createBranchTestState({ scenario: "minimal" });
  });
  beforeEach(() => {
    state.applyEnv();
  });
  afterAll(async () => {
    await state?.cleanup();
  });
  afterEach(async () => {
    await flushPendingSessionsChangedEvents();
    await disposeSessionReadContexts();
    await drainSessionStateForTest({ stateDir: state.stateDir, rootPath: state.root });
    vi.restoreAllMocks();
    await deletePersistentSessionStoreRows({
      agentId: "main",
      storePath: path.join(state.sessionsDir(), "sessions.json"),
    });
    await drainSessionStateForTest({ stateDir: state.stateDir, rootPath: state.root });
  });
  return async (run: (state: BranchTestState) => Promise<void>) => {
    const work = new AsyncWorkScope();
    try {
      await work.track(() => run(state));
    } finally {
      await work.drain();
    }
  };
}
