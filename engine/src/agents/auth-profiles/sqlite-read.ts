import path from "node:path";
import { isRecord } from "@branch/normalization-core/record-coerce";
import type { Result } from "@branch/normalization-core/result";
import { cloneEnvWithPlatformSemantics } from "../../config/config-env-vars.js";
import { runSqliteReadOnlyWorker } from "../../infra/sqlite-readonly-worker.js";
import { inspectDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import { registerBranchAgentDatabaseAsyncResource } from "../../state/branch-agent-db-resources.js";
import { registerBranchStateDatabaseAsyncResource } from "../../state/branch-state-db-cache.js";
import { isArtifactPreservingStateRead } from "../../state/branch-state-db-readonly.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import { runBranchStateWorkerOperation } from "../../state/branch-state-worker-store.js";
import { registerUserModelAuthProfileSecrets } from "../../state/user-model-accounts.js";
import { mergePersistedAuthProfileState } from "./persisted.js";
import { AuthProfileStoreUnreadableError } from "./store-unreadable-error.js";
import type {
  AuthProfileStore,
  AuthProfileRowRead,
  PersistedAuthProfileStoreInspection,
  UserModelAuthProfile,
} from "./types.js";

/** Decode worker-read facts with the same store/state coercion as synchronous reads. */
export function loadPersistedAuthProfileStoreFromRows(
  rows: AuthProfileRowRead,
  databasePath: string,
): AuthProfileStore | null {
  const store = mergePersistedAuthProfileState(
    rows.store.status === "readable" ? rows.store.raw : null,
    () => (rows.state.status === "readable" ? rows.state.raw : null),
  );
  if (!store && rows.store.status !== "missing") {
    throw new AuthProfileStoreUnreadableError(databasePath);
  }
  return store;
}

const missing: AuthProfileRowRead = {
  store: { status: "missing", reason: "database" },
  state: { status: "missing", reason: "database" },
  cacheable: false,
};

function isInspection(value: unknown): value is PersistedAuthProfileStoreInspection {
  return (
    isRecord(value) &&
    (value.status === "unreadable" ||
      (value.status === "readable" && Object.hasOwn(value, "raw")) ||
      (value.status === "missing" &&
        (value.reason === "database" || value.reason === "table" || value.reason === "row")))
  );
}

/** Captured read authority survives all awaits until the runtime composition releases it. */
export function prepareAgentAuthProfileRowsRead(options: {
  databasePath: string;
  agentId: string;
  env: NodeJS.ProcessEnv;
}): {
  read: () => Promise<AuthProfileRowRead>;
  assertCurrent: () => void;
  dispose: () => Promise<void>;
} {
  const databasePath = path.resolve(options.databasePath);
  const agentId = options.agentId;
  const env = cloneEnvWithPlatformSemantics(options.env);
  let identity: ReturnType<typeof inspectDatabasePathIdentitySync>;
  try {
    identity = inspectDatabasePathIdentitySync(databasePath);
  } catch {
    identity = undefined;
  }
  const captured: Result<BranchStateWorkerContext, unknown> = (() => {
    try {
      return {
        ok: true,
        value: captureBranchStateWorkerContext({ env }),
      };
    } catch (error) {
      return { ok: false, error };
    }
  })();
  const controller = new AbortController();
  const pending = new Set<Promise<AuthProfileRowRead>>();
  let closed = false;
  let revoked = false;
  let closing: Promise<void> | undefined;
  let unregisterAgent: (() => void) | undefined;
  let unregisterRoot: (() => void) | undefined;
  const revoke = () => {
    revoked = true;
    controller.abort(new Error("Auth profile read owner was revoked"));
  };
  const assertCurrent = () => {
    if (revoked) {
      throw new Error("Auth profile read owner was revoked");
    }
    if (!captured.ok) {
      throw captured.error;
    }
    captured.value.admission.assertCurrent();
    captured.value.maintenanceScope?.assertAdmission();
    if (identity && inspectDatabasePathIdentitySync(databasePath)?.key !== identity.key) {
      throw new Error("Auth profile database file identity changed during its read");
    }
    // Cached rows still borrow this read's revocable authority through host composition.
    if (!closed) {
      register();
    }
  };
  const dispose = (): Promise<void> => {
    closed = true;
    controller.abort(new Error("Auth profile read owner closed"));
    closing ??= (async () => {
      await Promise.allSettled(pending);
      unregisterRoot?.();
      unregisterAgent?.();
    })().catch((error: unknown) => {
      closing = undefined;
      throw error;
    });
    return closing;
  };
  const register = () => {
    if (unregisterAgent || !captured.ok) {
      return;
    }
    const root = captured.value;
    const registerOwners = () => {
      unregisterAgent = registerBranchAgentDatabaseAsyncResource({
        agentId,
        path: databasePath,
        revoke,
        close: dispose,
      });
      try {
        unregisterRoot = registerBranchStateDatabaseAsyncResource({
          close: async (closedIdentity) => {
            if (!closedIdentity || closedIdentity.key === root.admission.identity.key) {
              revoke();
              await dispose();
            }
          },
        });
      } catch (error) {
        unregisterAgent();
        unregisterAgent = undefined;
        throw error;
      }
    };
    if (root.maintenanceScope) {
      root.maintenanceScope.run(registerOwners);
    } else {
      registerOwners();
    }
  };
  const read = (): Promise<AuthProfileRowRead> => {
    if (closed) {
      return Promise.reject(new Error("Auth profile read owner closed"));
    }
    const operation = (async () => {
      assertCurrent();
      if (!identity) {
        return {
          store: { status: "unreadable" },
          state: { status: "unreadable" },
          cacheable: false,
        } satisfies AuthProfileRowRead;
      }
      if (!identity.key.startsWith("file:")) {
        return missing;
      }
      const rows = await runSqliteReadOnlyWorker(databasePath, {
        mode: "auth-profile-rows",
        source: "canonical",
        expectedIdentity: identity.key,
        env,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      assertCurrent();
      if (!isInspection(rows.store) || !isInspection(rows.state)) {
        throw new Error("Auth profile reader returned invalid inspection rows");
      }
      return { store: rows.store, state: rows.state, cacheable: rows.cacheable };
    })();
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => undefined);
    return operation;
  };
  return { read, assertCurrent, dispose };
}

/** Shared auth reads reuse the canonical actor and never request a writable open. */
export async function readSharedAuthProfileRows(
  context: BranchStateWorkerContext,
): Promise<AuthProfileRowRead> {
  const result = await runBranchStateWorkerOperation(
    context,
    (scope) =>
      scope.execute({
        type: "authProfiles.read",
        input: { artifactPreserving: isArtifactPreservingStateRead() },
      }),
    { existingOnly: true },
  );
  context.admission.assertCurrent();
  return result ?? missing;
}

/** Read one selected account on the canonical actor; redaction remains caller-owned. */
export async function readUserModelAuthProfileAsync(
  authProfileId: string,
  context: BranchStateWorkerContext,
): Promise<UserModelAuthProfile | undefined> {
  const profile = await runBranchStateWorkerOperation(
    context,
    (scope) =>
      scope.execute({
        type: "authProfiles.personal",
        input: { profileId: authProfileId, artifactPreserving: isArtifactPreservingStateRead() },
      }),
    { existingOnly: true },
  );
  context.admission.assertCurrent();
  if (profile) {
    registerUserModelAuthProfileSecrets(profile.credential);
  }
  return profile;
}
