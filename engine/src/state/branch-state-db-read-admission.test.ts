import fs, {
  existsSync,
  linkSync,
  mkdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { afterEach, expect, it, vi } from "vitest";
import { SQLITE_WORKER_PREPARE_COMMAND } from "../infra/sqlite-worker-contract.js";
import * as databaseIdentity from "../infra/sqlite-worker-identity.js";
import { runWithSqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import * as workerStore from "../infra/sqlite-worker-store.js";
import { createPluginStateKeyedStore } from "../plugin-state/plugin-state-store.js";
import { createDeferredCore } from "../shared/deferred.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  createBranchDatabaseMaintenanceScope,
  createBranchStateDatabaseAsyncLifecycle,
} from "./branch-state-db-async-lifecycle.js";
import * as stateCache from "./branch-state-db-cache.js";
import {
  captureBranchStateDatabaseReadAdmission,
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseByPath,
  publishBranchStateDatabaseWorkerAdmission,
} from "./branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { withBranchStateDatabaseReadOnly } from "./branch-state-db-readonly.js";
import { withExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import {
  captureBranchStateWorkerContext,
  prepareBranchStateReadSource,
} from "./branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import { getBranchStateWorkerOwner } from "./branch-state-worker-owner.js";
import { runBranchStateWorkerOperation } from "./branch-state-worker-store.js";
import { openExistingSqliteWorkerBackend } from "./branch-state.worker.js";

const hostBirth: {
  paths: Set<string>;
  mode: "zero" | "changing" | "ctime" | undefined;
  relocated: boolean;
  ctimeAdvanceNs: bigint;
} = { paths: new Set(), mode: undefined, relocated: false, ctimeAdvanceNs: 0n };

afterEach(async () => {
  try {
    await closeBranchStateDatabaseAsync();
  } finally {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    hostBirth.paths.clear();
    hostBirth.mode = undefined;
    hostBirth.relocated = false;
    hostBirth.ctimeAdvanceNs = 0n;
  }
});

function observeHostBirthtime(mode: typeof hostBirth.mode, paths: string[]): void {
  hostBirth.mode = mode;
  for (const pathname of paths) {
    hostBirth.paths.add(pathname);
    hostBirth.paths.add(
      path.join(realpathSync.native(path.dirname(pathname)), path.basename(pathname)),
    );
  }
  if (!mode) {
    return;
  }
  const readStat = fs.statSync;
  vi.spyOn(fs, "statSync").mockImplementation((...args) => {
    const result = readStat(...args);
    if (result && args[1]?.bigint && hostBirth.paths.has(String(args[0]))) {
      if (mode === "ctime" && "ctimeNs" in result) {
        const ctimeNs = result.ctimeNs + hostBirth.ctimeAdvanceNs;
        Object.defineProperty(result, "ctimeNs", { value: ctimeNs });
        Object.defineProperty(result, "birthtimeNs", { value: ctimeNs });
      } else {
        Object.defineProperty(result, "birthtimeNs", {
          value: mode === "zero" ? 0n : hostBirth.relocated ? 2n : 1n,
        });
      }
    }
    return result;
  });
  // Native-passthrough identity modules must observe the same builtin as this test.
  syncBuiltinESMExports();
}

// Coarse-timestamp filesystems (ext4 before Linux 6.13, CI overlays) keep ctime across a
// write or link within one clock tick; advance it explicitly so fallback birthtime moves.
function advanceHostCtime(): void {
  hostBirth.ctimeAdvanceNs += 1n;
}

it("permits a lazy native write after healthy peer changes when birthtime falls back to ctime", async () => {
  await withBranchTestState({ label: "state-ctime-lazy" }, async (state) => {
    const pathname = openBranchStateDatabase({ env: state.env }).path;
    await closeBranchStateDatabaseAsync();
    const alias = state.statePath("same-file-alias.sqlite");
    observeHostBirthtime("ctime", [pathname, alias]);
    const before = statSync(pathname, { bigint: true });
    const captured = captureBranchStateWorkerContext({ env: state.env });
    const preparedRead =
      process.platform === "linux"
        ? prepareBranchStateReadSource({ path: pathname, env: state.env })
        : undefined;
    const backend = runWithSqliteWorkerStateContext(captured, () =>
      openExistingSqliteWorkerBackend(undefined, {
        databasePath: pathname,
        existingIdentity: captured.admission.identity.key,
      }),
    );
    try {
      await backend[SQLITE_WORKER_PREPARE_COMMAND]?.("config.health.patch");
      const peer = new DatabaseSync(pathname);
      peer.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION}`);
      peer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      peer.close();
      linkSync(pathname, alias);
      advanceHostCtime();
      const after = statSync(pathname, { bigint: true });
      expect(after.ino).toBe(before.ino);
      expect(after.birthtimeNs).not.toBe(before.birthtimeNs);
      const linked = captureBranchStateDatabaseReadAdmission(alias);
      expect(linked.identity.key).toBe(captured.admission.identity.key);
      expect(captured.admission.assertCurrent).not.toThrow();
      expect(linked.assertCurrent).not.toThrow();
      await withExistingBranchStateSchema({ path: pathname }, async () => {
        const current =
          preparedRead?.workerContext() ?? captureBranchStateWorkerContext({ env: state.env });
        expect(
          runWithSqliteWorkerStateContext(current, () =>
            backend.execute({
              type: "config.health.patch",
              input: {
                configPath: "/synthetic-ctime.json",
                patch: { last_observed_suspicious_signature: "healthy-peer" },
                expected: null,
                updatedAtMs: 100,
              },
            }),
          ),
        ).toBe(true);
        expect(captured.admission.identity.birthtime).toBe(
          process.platform === "linux" ? "0" : before.ctimeNs.toString(),
        );
        const database = openBranchStateDatabase({ env: state.env });
        expect(
          database.db
            .prepare(
              "SELECT last_observed_suspicious_signature FROM config_health_entries WHERE config_path = ?",
            )
            .get("/synthetic-ctime.json"),
        ).toEqual({ last_observed_suspicious_signature: "healthy-peer" });
      });
    } finally {
      await backend.close();
    }
  });
});

async function retainExistingReader(context: BranchStateWorkerContext) {
  await expect(
    runBranchStateWorkerOperation(
      context,
      (scope) =>
        scope.execute({
          type: "plugins.metadata.read",
          input: { selector: "installed-index", artifactPreservingReadOnly: true },
        }),
      { existingOnly: true },
    ),
  ).resolves.toBeUndefined();
  const store = await getBranchStateWorkerOwner().open(context, { existingOnly: true });
  expect(store).toBeDefined();
  return store!;
}

it.each(["native", "zero", "changing"] as const)(
  "joins a stale worker's retirement after same-inode relocation with %s birth timestamps",
  async (birth) => {
    await withBranchTestState({ label: "state-worker-inode-reuse" }, async (state) => {
      const inspectedPath = state.statePath("inspected.sqlite");
      const inspected = new DatabaseSync(inspectedPath);
      inspected.exec("PRAGMA user_version = 0");
      inspected.close();
      const databasePath = resolveBranchStateSqlitePath(state.env);
      const readIdentity = databaseIdentity.readDatabasePathIdentitySync;
      const retiredKey = readIdentity(inspectedPath).key;
      mkdirSync(path.dirname(databasePath), { recursive: true });
      observeHostBirthtime(birth === "native" ? undefined : birth, [inspectedPath, databasePath]);
      const context = captureBranchStateWorkerContext({ path: inspectedPath, env: state.env });
      const retained = await retainExistingReader(context);
      const actor = workerStore.getSqliteWorkerActorIdentity(retained);
      renameSync(inspectedPath, databasePath);
      hostBirth.relocated = true;
      expect(readIdentity(databasePath).key).toBe(retiredKey);

      const retiring = createDeferredCore();
      const releaseRetirement = createDeferredCore();
      const retireActor = workerStore.retireSqliteWorkerActor;
      const retirement = vi
        .spyOn(workerStore, "retireSqliteWorkerActor")
        .mockImplementationOnce(async (identity) => {
          expect(identity).toBe(actor);
          retiring.resolve();
          await releaseRetirement.promise;
          await retireActor(identity);
        });
      const store = createPluginStateKeyedStore<string>("discord", {
        namespace: "worker-inode-reuse",
        maxEntries: 1,
        env: state.env,
      });
      const registration = store.register("retained", "replacement");
      let settled = false;
      void registration.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      try {
        await Promise.race([
          retiring.promise,
          registration.then(() => {
            throw new Error("Replacement bypassed actor retirement");
          }),
        ]);
        expect(settled).toBe(false);
        expect(context.admission.assertCurrent).toThrow(/admission changed/);
        releaseRetirement.resolve();
        await registration;
        await expect(store.lookup("retained")).resolves.toBe("replacement");
        expect(retirement).toHaveBeenCalledExactlyOnceWith(actor);
        expect(workerStore.isSqliteWorkerStoreAvailable(retained)).toBe(false);
        expect(existsSync(inspectedPath)).toBe(false);
      } finally {
        releaseRetirement.resolve();
        await Promise.allSettled([registration]);
        retirement.mockRestore();
      }
    });
  },
);

it.each(["same scope", "different scope"] as const)(
  "refuses replacement from an active callback on a stale actor (%s)",
  async (ownership) => {
    await withBranchTestState({ label: "state-worker-active-replacement" }, async (state) => {
      const inspectedPath = state.statePath("inspected.sqlite");
      new DatabaseSync(inspectedPath).close();
      const context = captureBranchStateWorkerContext({ path: inspectedPath, env: state.env });
      const retained = await retainExistingReader(context);
      const maintenance =
        ownership === "different scope" ? createBranchDatabaseMaintenanceScope() : undefined;
      const activeContext = maintenance
        ? maintenance.run(() =>
            captureBranchStateWorkerContext({ path: inspectedPath, env: state.env }),
          )
        : context;
      const databasePath = resolveBranchStateSqlitePath(state.env);
      const store = createPluginStateKeyedStore<string>("discord", {
        namespace: "active-replacement",
        maxEntries: 1,
        env: state.env,
      });
      const retiring = createDeferredCore();
      const retireActor = workerStore.retireSqliteWorkerActor;
      const retirement = vi
        .spyOn(workerStore, "retireSqliteWorkerActor")
        .mockImplementation((identity) => {
          retiring.resolve();
          return retireActor(identity);
        });
      let registration: Promise<unknown> | undefined;
      try {
        try {
          await runBranchStateWorkerOperation(
            activeContext,
            async () => {
              mkdirSync(path.dirname(databasePath), { recursive: true });
              renameSync(inspectedPath, databasePath);
              registration = store.register("retained", "replacement");
              // Observe retirement to fail without stranding the callback on its own close.
              await expect(
                Promise.race([
                  registration.then(
                    () => ({ outcome: "written" }),
                    (error: unknown) => ({ outcome: "refused", error }),
                  ),
                  retiring.promise.then(() => ({ outcome: "retiring" })),
                ]),
              ).resolves.toMatchObject({
                outcome: "refused",
                error: {
                  code: "PLUGIN_STATE_OPEN_FAILED",
                  cause: { code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED" },
                },
              });
              expect(workerStore.isSqliteWorkerStoreAvailable(retained)).toBe(true);
            },
            { existingOnly: true },
          );
        } finally {
          await Promise.allSettled([registration]);
          retirement.mockRestore();
        }
        await store.register("retained", "replacement");
        await expect(store.lookup("retained")).resolves.toBe("replacement");
        expect(existsSync(inspectedPath)).toBe(false);
      } finally {
        await maintenance?.close();
      }
    });
  },
);

it("reuses a current database actor across separate lexical schema scopes", async () => {
  await withBranchTestState({ label: "state-worker-schema-scope" }, async (state) => {
    const databasePath = openBranchStateDatabase({ env: state.env }).path;
    await closeBranchStateDatabaseAsync();
    const read = () =>
      withExistingBranchStateSchema({ path: databasePath }, () =>
        retainExistingReader(
          captureBranchStateWorkerContext({ path: databasePath, env: state.env }),
        ),
      );
    const first = await read();
    const second = await read();
    expect(second).toBe(first);
    expect(workerStore.isSqliteWorkerStoreAvailable(first)).toBe(true);
  });
});

it("propagates an unexpected recorded-admission error without retiring the actor", async () => {
  await withBranchTestState({ label: "state-worker-admission-error" }, async (state) => {
    const databasePath = state.statePath("inspected.sqlite");
    new DatabaseSync(databasePath).close();
    const context = captureBranchStateWorkerContext({ path: databasePath, env: state.env });
    const capture = stateCache.captureBranchStateDatabaseReadAdmission;
    const failure = new Error("Unexpected database admission failure");
    let reject = false;
    const captureAdmission = vi
      .spyOn(stateCache, "captureBranchStateDatabaseReadAdmission")
      .mockImplementationOnce((pathname) => {
        const admission = capture(pathname);
        return {
          ...admission,
          assertCurrent() {
            if (reject) {
              throw failure;
            }
            admission.assertCurrent();
          },
        };
      });
    const retained = await retainExistingReader(context);
    captureAdmission.mockRestore();
    reject = true;
    try {
      await expect(
        getBranchStateWorkerOwner().open(context, { existingOnly: true }),
      ).rejects.toBe(failure);
      expect(workerStore.isSqliteWorkerStoreAvailable(retained)).toBe(true);
    } finally {
      reject = false;
    }
  });
});

it.each(["read", "refused-read", "closed-writer"] as const)(
  "admits first worker creation when a retired %s inode becomes its target",
  async (kind) => {
    await withBranchTestState({ label: "state-read-admission" }, async (state) => {
      const inspectedPath = path.join(state.stateDir, "inspected.sqlite");
      const inspected = new DatabaseSync(inspectedPath);
      inspected.exec(
        `PRAGMA user_version = ${kind === "refused-read" ? BRANCH_STATE_SCHEMA_VERSION + 1 : 0}`,
      );
      inspected.close();
      const retiredIdentity = databaseIdentity.readDatabasePathIdentitySync(inspectedPath);
      const read = () =>
        withBranchStateDatabaseReadOnly(() => "inspected", {
          path: inspectedPath,
          env: state.env,
        });
      let assertRetiredAdmission: (() => void) | undefined;
      if (kind === "closed-writer") {
        openBranchStateDatabase({ path: inspectedPath, env: state.env });
        assertRetiredAdmission =
          captureBranchStateDatabaseReadAdmission(inspectedPath).assertCurrent;
        closeBranchStateDatabaseByPath(inspectedPath);
      } else if (kind === "refused-read") {
        expect(read).toThrow(/newer schema/);
      } else {
        expect(read()).toBe("inspected");
      }
      const retainedPath = state.statePath("retained-inode.sqlite");
      renameSync(inspectedPath, retainedPath);
      const databasePath = resolveBranchStateSqlitePath(state.env);
      mkdirSync(path.dirname(databasePath), { recursive: true });
      const canonicalTarget = path.join(
        realpathSync.native(path.dirname(databasePath)),
        path.basename(databasePath),
      );
      let moved = false;
      const interceptOpen = () => {
        const dispatch = vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (
          this: Worker,
          message,
          ...args
        ) {
          dispatch.mockRestore();
          if (
            isRecord(message) &&
            message.type === "open" &&
            message.databasePath === canonicalTarget
          ) {
            // The target is absent at admission, then gets the real retained inode before native open.
            renameSync(retainedPath, databasePath);
            writeFileSync(databasePath, "");
            expect(databaseIdentity.readDatabasePathIdentitySync(databasePath).key).toBe(
              retiredIdentity.key,
            );
            moved = true;
          }
          try {
            return this.postMessage(message, ...args);
          } finally {
            if (!moved) {
              interceptOpen();
            }
          }
        });
      };
      interceptOpen();
      const store = createPluginStateKeyedStore<string>("discord", {
        namespace: "read-admission",
        maxEntries: 1,
        env: state.env,
      });
      await store.register("retained", "original");
      expect(moved).toBe(true);
      expect(existsSync(inspectedPath)).toBe(false);
      await expect(store.lookup("retained")).resolves.toBe("original");
      if (assertRetiredAdmission) {
        expect(assertRetiredAdmission).toThrow(/admission changed/);
      }
    });
  },
);

it("binds an in-flight first creation when a native alias publishes first", async () => {
  await withBranchTestState({ label: "state-native-alias-admission" }, async (state) => {
    const databasePath = resolveBranchStateSqlitePath(state.env);
    const alias = path.join(path.dirname(databasePath), "alias.sqlite");
    const admission = captureBranchStateDatabaseReadAdmission(databasePath);
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const created = new DatabaseSync(databasePath);
    created.close();
    linkSync(databasePath, alias);

    openBranchStateDatabase({ path: alias, env: state.env });
    publishBranchStateDatabaseWorkerAdmission(admission);
    admission.assertCurrent();
  });
});

it("keeps live aliases when an earlier recorded path becomes a directory", async () => {
  await withBranchTestState({ label: "state-stale-alias-admission" }, async (state) => {
    const lifecycle = createBranchStateDatabaseAsyncLifecycle();
    const originalPath = state.statePath("original.sqlite");
    const retainedAlias = state.statePath("retained.sqlite");
    const newAlias = state.statePath("new-alias.sqlite");
    writeFileSync(originalPath, "original");
    const original = lifecycle.capture(originalPath);
    linkSync(originalPath, retainedAlias);
    const retained = lifecycle.capture(retainedAlias);
    linkSync(originalPath, newAlias);
    unlinkSync(originalPath);
    mkdirSync(originalPath);

    const observed = lifecycle.capture(newAlias);
    expect(observed.identity.key).toBe(original.identity.key);
    expect(original.assertCurrent).toThrow(/admission changed/);
    retained.assertCurrent();
    observed.assertCurrent();
  });
});

it("keeps a replacement and its aliases sealed until file exclusion releases", async () => {
  await withBranchTestState({ label: "state-replacement-admission" }, async (state) => {
    const lifecycle = createBranchStateDatabaseAsyncLifecycle();
    const databasePath = state.statePath("replaced.sqlite");
    const alias = state.statePath("alias.sqlite");
    writeFileSync(databasePath, "original");
    const original = lifecycle.capture(databasePath);
    const release = lifecycle.holdExclusion(databasePath);
    try {
      renameSync(databasePath, state.statePath("retired.sqlite"));
      writeFileSync(databasePath, "replacement");
      linkSync(databasePath, alias);
      lifecycle.publish(databasePath);
      expect(() => lifecycle.capture(alias)).toThrow(/admission is closed/);
    } finally {
      release();
    }
    expect(original.assertCurrent).toThrow(/admission changed/);
    const replacement = lifecycle.capture(alias);
    expect(replacement.identity.key).not.toBe(original.identity.key);
    replacement.assertCurrent();
  });
});
