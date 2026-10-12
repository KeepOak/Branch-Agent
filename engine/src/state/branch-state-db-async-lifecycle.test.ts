import { existsSync, linkSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { acquireGatewayStateOwner } from "../infra/gateway-state-owner.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import * as databaseIdentity from "../infra/sqlite-worker-identity.js";
import { createDeferredCore } from "../shared/deferred.js";
import { drainGlobalSingletonLifecycleState } from "../shared/global-singleton.js";
import {
  createBranchDatabaseMaintenanceScope,
  createBranchStateDatabaseAsyncLifecycle,
} from "./branch-state-db-async-lifecycle.js";
import {
  clearBranchStateDatabaseOpenFailure,
  prepareBranchStateDatabaseRemoval,
  captureBranchStateDatabaseReadAdmission,
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseByPath,
  closeBranchStateDatabaseByPathAsync,
  publishBranchStateDatabaseWorkerAdmission,
  registerBranchStateDatabaseAsyncResource,
} from "./branch-state-db-cache.js";
import { openBranchStateReadConnection } from "./branch-state-db-read-connection.js";
import { withExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import {
  captureBranchStateReadContext,
  prepareBranchStateReadSource,
} from "./branch-state-worker-context.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);

function databasePath(name = "state") {
  return path.join(dirs.make("branch-async-drain-"), `${name}.sqlite`);
}

describe("canonical shared-state resource drainage", () => {
  it.each(["ordinary", "existing", "admission"] as const)(
    "reuses warm %s facts without resolving paths or allocating replacement tokens",
    (kind) => {
      const pathname = databasePath();
      writeFileSync(pathname, "");
      const consume = () => {
        const lifecycle = createBranchStateDatabaseAsyncLifecycle();
        const source = prepareBranchStateReadSource({ path: pathname });
        const capture = kind === "admission" ? () => lifecycle.capture(pathname) : source.current;
        const retained = capture();
        const resolve = vi.spyOn(path, "resolve");
        let reused = true;
        let resolutions: number;
        try {
          for (let index = 0; index < 100; index++) {
            const current = capture();
            if ("assertCurrent" in current) {
              current.assertCurrent();
            }
            reused &&= current === retained;
          }
          resolutions = resolve.mock.calls.length;
        } finally {
          resolve.mockRestore();
        }
        expect(resolutions).toBe(0);
        expect(reused).toBe(true);
        if ("assertCurrent" in retained) {
          lifecycle.invalidate(pathname);
          expect(retained.assertCurrent).toThrow(/admission changed/);
          const renewed = lifecycle.capture(pathname);
          expect(renewed).not.toBe(retained);
          renewed.assertCurrent();
        }
      };
      if (kind === "existing") {
        withExistingBranchStateSchema({ path: pathname }, consume);
      } else {
        consume();
      }
    },
  );

  it("renews prepared reads of the same file without adopting its replacement", async () => {
    const pathname = databasePath();
    const source = prepareBranchStateReadSource({ path: pathname });
    const absent = source.current();
    const coordinationKey = absent.admission.coordinationKey;
    writeFileSync(pathname, "");
    const created = source.current();
    expect(created.admission.identity.key).toMatch(/^file:/);
    expect(created.admission.coordinationKey).toBe(coordinationKey);
    absent.admission.assertCurrent();
    await closeBranchStateDatabaseByPathAsync(pathname);
    const renewed = source.current();
    expect(created.admission.assertCurrent).toThrow(/admission changed/);
    expect(renewed.admission.identity.key).toBe(created.admission.identity.key);
    await closeBranchStateDatabaseByPathAsync(pathname);
    renameSync(pathname, `${pathname}.retired`);
    writeFileSync(pathname, "");
    const replacement = captureBranchStateReadContext(pathname);
    expect(replacement.admission.identity.key).not.toBe(created.admission.identity.key);
    expect(source.current).toThrow(/identity changed/);
    expect(source.workerContext).toThrow(/identity changed/);
  });

  it("keeps captured schema scope lifetime separate from shared physical admission", async () => {
    const pathname = databasePath();
    const ordinary = captureBranchStateReadContext(pathname);
    const restricted = withExistingBranchStateSchema({ path: pathname }, () => {
      const context = captureBranchStateReadContext(pathname);
      writeFileSync(pathname, "");
      const created = captureBranchStateDatabaseReadAdmission(pathname);
      expect(context.admission.identity.key).toBe(created.identity.key);
      expect(context.admission.identity.key).toMatch(/^file:/);
      context.admission.assertCurrent();
      return { context, source: prepareBranchStateReadSource({ path: pathname }) };
    });
    expect(restricted.context.admission.assertCurrent).toThrow(/schema admission has ended/);
    expect(restricted.source.current).toThrow(/schema admission has ended/);
    ordinary.admission.assertCurrent();
    captureBranchStateReadContext(pathname).admission.assertCurrent();
    await closeBranchStateDatabaseByPathAsync(pathname);
    expect(restricted.source.current).toThrow(/schema admission has ended/);
  });

  it.each(["missing", "directory"] as const)(
    "keeps unrelated owners while closing a never-admitted %s path",
    async (kind) => {
      const pathname = databasePath(kind);
      if (kind === "directory") {
        mkdirSync(pathname);
        expect(() => captureBranchStateDatabaseReadAdmission(pathname)).toThrow(/regular file/);
        expect(() => openBranchStateDatabase({ path: pathname })).toThrow(/regular file/);
      }
      const owner = openBranchStateDatabase({ path: databasePath("retained") });
      const admission = captureBranchStateDatabaseReadAdmission(owner.path);
      const unregister = registerBranchStateDatabaseAsyncResource({
        async close(identity) {
          if (identity === undefined) {
            throw new Error("Unexpected global resource drain");
          }
          if (identity.key === admission.identity.key) {
            owner.db.close();
          }
        },
      });
      try {
        expect(closeBranchStateDatabaseByPath(pathname)).toBe(false);
        expect(await closeBranchStateDatabaseByPathAsync(pathname)).toBe(false);
        expect(owner.db.isOpen).toBe(true);
        admission.assertCurrent();
        expect(existsSync(pathname)).toBe(kind === "directory");
      } finally {
        unregister();
      }
    },
  );

  it("keeps first-creation admission when an alias supplies the physical identity", async () => {
    const lifecycle = createBranchStateDatabaseAsyncLifecycle();
    const pathname = databasePath();
    const alias = path.join(path.dirname(pathname), "created-alias.sqlite");
    const original = lifecycle.capture(pathname);
    expect(original.identity.key).toMatch(/^path:/);
    const coordinationKey = original.coordinationKey;
    expect(coordinationKey).toBe(original.identity.key);
    writeFileSync(pathname, "");
    linkSync(pathname, alias);
    const observed = lifecycle.capture(alias);
    expect(original.identity.key).toBe(observed.identity.key);
    expect(original.coordinationKey).toBe(coordinationKey);
    expect(observed.coordinationKey).toBe(coordinationKey);
    lifecycle.publish(pathname);
    expect(lifecycle.capture(pathname).coordinationKey).toBe(coordinationKey);
    original.assertCurrent();
    observed.assertCurrent();
    const closing = lifecycle.close(alias, () => false);
    expect(original.assertCurrent).toThrow(/admission is closed/);
    await closing;
    expect(original.assertCurrent).toThrow(/admission changed/);
    expect(observed.assertCurrent).toThrow(/admission changed/);
  });

  it.each(["first-creation", "replacement"] as const)(
    "publishes physical identity without renewing revoked read authority (%s)",
    (creation) => {
      const pathname = databasePath();
      if (creation === "replacement") {
        writeFileSync(pathname, "original");
      }
      const original = captureBranchStateDatabaseReadAdmission(pathname);
      const originalKey = original.identity.key;
      const coordinationKey = original.coordinationKey;
      clearBranchStateDatabaseOpenFailure(pathname);
      expect(original.assertCurrent).toThrow(/admission changed/);
      if (creation === "replacement") {
        renameSync(pathname, `${pathname}.retired`);
      }
      writeFileSync(pathname, "created");
      const physical = databaseIdentity.readDatabasePathIdentitySync(pathname);
      expect(physical.key).not.toBe(originalKey);
      expect(() => publishBranchStateDatabaseWorkerAdmission(original)).toThrow(
        /admission changed/,
      );
      expect(original.assertCurrent).toThrow(/admission changed/);
      expect(original.coordinationKey).toBe(coordinationKey);
      if (creation === "first-creation") {
        expect(original.identity.key).toBe(physical.key);
      } else {
        expect(original.identity.key).toBe(originalKey);
        expect(original.identity.key).not.toBe(physical.key);
      }
    },
  );

  it("normalizes relative paths for identity, invalidation, exclusion, and closure", async () => {
    const lifecycle = createBranchStateDatabaseAsyncLifecycle();
    const pathname = databasePath();
    const relative = path.relative(process.cwd(), pathname);
    writeFileSync(pathname, "");
    const original = lifecycle.capture(relative);
    expect(original.databasePath).toBe(pathname);
    expect(lifecycle.publish(relative).identity).toEqual(original.identity);
    expect(lifecycle.identity(relative)).toBe(original.identity);
    expect(lifecycle.knownIdentity(relative)).toBe(original.identity);
    lifecycle.invalidate(relative);
    expect(original.assertCurrent).toThrow(/admission changed/);
    const current = lifecycle.capture(pathname);
    const release = lifecycle.holdExclusion(relative);
    try {
      expect(current.assertCurrent).toThrow(/admission is closed/);
      expect(() => lifecycle.capture(pathname)).toThrow(/admission is closed/);
    } finally {
      release();
    }
    expect(lifecycle.knownIdentity(relative)).toBeUndefined();
    const reopened = lifecycle.capture(pathname);
    const retireNative = vi.fn(() => false);
    await lifecycle.close(relative, retireNative);
    expect(retireNative).toHaveBeenCalledWith(reopened.identity);
    expect(reopened.assertCurrent).toThrow(/admission changed/);
  });

  it("shares recorded admission and closes native owners for one physical database", async () => {
    const pathname = databasePath();
    const original = openBranchStateDatabase({ path: pathname });
    const alias = path.join(path.dirname(pathname), "alias.sqlite");
    linkSync(pathname, alias);
    const originalAdmission = captureBranchStateDatabaseReadAdmission(pathname);
    const aliasAdmission = captureBranchStateDatabaseReadAdmission(alias);
    expect(aliasAdmission.identity.key).toBe(originalAdmission.identity.key);
    expect(aliasAdmission.coordinationKey).toBe(originalAdmission.coordinationKey);
    expect(aliasAdmission.databasePath).toBe(alias);
    const identityReads = vi.spyOn(databaseIdentity, "readDatabasePathIdentitySync");
    const resolvePath = vi.spyOn(path, "resolve");
    try {
      captureBranchStateDatabaseReadAdmission(pathname).assertCurrent();
      captureBranchStateDatabaseReadAdmission(alias).assertCurrent();
      expect(resolvePath.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      resolvePath.mockRestore();
    }
    expect(identityReads).not.toHaveBeenCalled();
    identityReads.mockRestore();
    const closed = vi.fn(async (_identity?: DatabasePathIdentity) => {});
    const unregister = registerBranchStateDatabaseAsyncResource({ close: closed });
    try {
      const closing = closeBranchStateDatabaseByPathAsync(alias);
      expect(originalAdmission.assertCurrent).toThrow(/admission is closed/);
      expect(aliasAdmission.assertCurrent).toThrow(/admission is closed/);
      await closing;
      expect(closed).toHaveBeenCalledWith(originalAdmission.identity);
      expect(original.db.isOpen).toBe(false);
    } finally {
      unregister();
    }
  });

  it.each(["path", "all", "restart"] as const)(
    "joins the native reader before %s retirement and invalidates old admissions",
    async (scope) => {
      const pathname = databasePath();
      const admitted = captureBranchStateDatabaseReadAdmission(pathname);
      const writer = openBranchStateDatabase({ path: pathname });
      // Successful native admission does not invalidate its own captured generation.
      admitted.assertCurrent();
      const reader = openBranchStateReadConnection(pathname, pathname);
      const entered = createDeferredCore();
      const finish = createDeferredCore();
      const unregister = registerBranchStateDatabaseAsyncResource({
        async close(target) {
          if (target !== undefined && target.key !== admitted.identity.key) {
            return;
          }
          entered.resolve();
          await finish.promise;
          reader.close();
        },
      });
      const closing =
        scope === "path"
          ? closeBranchStateDatabaseByPathAsync(pathname)
          : scope === "all"
            ? closeBranchStateDatabaseAsync()
            : drainGlobalSingletonLifecycleState("restart");
      try {
        expect(admitted.assertCurrent).toThrow(/admission is closed/);
        await entered.promise;
        expect(writer.db.isOpen).toBe(true);
        expect(reader.database.db.isOpen).toBe(true);
        finish.resolve();
        await closing;
        expect(reader.database.db.isOpen).toBe(false);
        expect(writer.db.isOpen).toBe(false);
        expect(admitted.assertCurrent).toThrow(/admission changed/);
        captureBranchStateDatabaseReadAdmission(pathname).assertCurrent();
        const reopened = openBranchStateDatabase({ path: pathname });
        expect(reopened.db.isOpen).toBe(true);
      } finally {
        finish.resolve();
        await closing;
        unregister();
      }
    },
  );

  it("retains an unregistered multipath resource after failure and retries only requested paths", async () => {
    const first = openBranchStateDatabase({ path: databasePath("first") });
    const second = openBranchStateDatabase({ path: databasePath("second") });
    const firstReader = openBranchStateReadConnection(first.path, first.path);
    const secondReader = openBranchStateReadConnection(second.path, second.path);
    const firstIdentity = captureBranchStateDatabaseReadAdmission(first.path).identity;
    const secondIdentity = captureBranchStateDatabaseReadAdmission(second.path).identity;
    const failure = new Error("reader close incomplete");
    let failFirst = true;
    const close = vi.fn(async (target?: DatabasePathIdentity) => {
      if (target === undefined || target.key === firstIdentity.key) {
        if (failFirst) {
          throw failure;
        }
        firstReader.close();
      }
      if (target === undefined || target.key === secondIdentity.key) {
        secondReader.close();
      }
    });
    const unregister = registerBranchStateDatabaseAsyncResource({ close });
    try {
      await expect(closeBranchStateDatabaseByPathAsync(first.path)).rejects.toBe(failure);
      unregister();
      expect(first.db.isOpen).toBe(true);
      expect(firstReader.database.db.isOpen).toBe(true);
      expect(() => captureBranchStateDatabaseReadAdmission(first.path)).toThrow(/closed/);
      captureBranchStateDatabaseReadAdmission(second.path).assertCurrent();
      await closeBranchStateDatabaseByPathAsync(second.path);
      expect(close).toHaveBeenLastCalledWith(secondIdentity);
      expect(second.db.isOpen).toBe(false);
      expect(secondReader.database.db.isOpen).toBe(false);
      expect(firstReader.database.db.isOpen).toBe(true);
      failFirst = false;
      await closeBranchStateDatabaseByPathAsync(first.path);
      expect(firstReader.database.db.isOpen).toBe(false);
      expect(first.db.isOpen).toBe(false);
      captureBranchStateDatabaseReadAdmission(first.path).assertCurrent();
    } finally {
      failFirst = false;
      await closeBranchStateDatabaseAsync();
      unregister();
    }
  });

  it("retains an unregistered finalizer skipped after an ordinary drain failure", async () => {
    const owner = openBranchStateDatabase({ path: databasePath() });
    const reader = openBranchStateReadConnection(owner.path, owner.path);
    const failure = new Error("ordinary resource did not settle");
    const finalize = vi.fn(async () => {
      reader.close();
    });
    const unregisterFinalizer = registerBranchStateDatabaseAsyncResource({
      phase: "after-resources",
      close: finalize,
    });
    const close = vi.fn<() => Promise<void>>().mockResolvedValue();
    close.mockImplementationOnce(async () => {
      unregisterFinalizer();
      throw failure;
    });
    const unregister = registerBranchStateDatabaseAsyncResource({ close });
    try {
      await expect(closeBranchStateDatabaseAsync()).rejects.toBe(failure);
      expect(finalize).not.toHaveBeenCalled();
      expect(owner.db.isOpen).toBe(true);
      expect(reader.database.db.isOpen).toBe(true);
      expect(() => captureBranchStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      await closeBranchStateDatabaseAsync();
      expect(close).toHaveBeenCalledTimes(2);
      expect(finalize).toHaveBeenCalledOnce();
      expect(reader.database.db.isOpen).toBe(false);
      expect(owner.db.isOpen).toBe(false);
    } finally {
      unregister();
      unregisterFinalizer();
      reader.close();
      await closeBranchStateDatabaseAsync();
    }
  });

  it("coalesces pending closes and retains the read seal after a native close failure", async () => {
    const owner = openBranchStateDatabase({ path: databasePath() });
    const nativeClose = owner.db.close.bind(owner.db);
    const failure = new Error("native close incomplete");
    const close = vi.spyOn(owner.db, "close").mockImplementationOnce(() => {
      throw failure;
    });
    try {
      const first = closeBranchStateDatabaseByPathAsync(owner.path);
      expect(closeBranchStateDatabaseByPathAsync(owner.path)).toBe(first);
      await expect(first).rejects.toBe(failure);
      expect(owner.db.isOpen).toBe(true);
      expect(() => captureBranchStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      close.mockImplementation(nativeClose);
      await closeBranchStateDatabaseByPathAsync(owner.path);
      expect(owner.db.isOpen).toBe(false);
      captureBranchStateDatabaseReadAdmission(owner.path).assertCurrent();
    } finally {
      close.mockRestore();
      await closeBranchStateDatabaseByPathAsync(owner.path);
    }
  });

  it("keeps worker admission sealed through maintenance preparation until release", async () => {
    const owner = openBranchStateDatabase({ path: databasePath() });
    const identity = captureBranchStateDatabaseReadAdmission(owner.path).identity;
    const reader = openBranchStateReadConnection(owner.path, owner.path);
    const entered = createDeferredCore();
    const finish = createDeferredCore();
    const unregister = registerBranchStateDatabaseAsyncResource({
      async close(target) {
        if (target === undefined || target.key === identity.key) {
          entered.resolve();
          await finish.promise;
          reader.close();
        }
      },
    });
    const processOwner = acquireGatewayStateOwner({ databasePath: owner.path });
    const assertOwnerCurrent = () => processOwner.assertCurrent();
    const maintenance = createBranchDatabaseMaintenanceScope({
      schemaMaintenance: true,
      assertOwnerCurrent,
      assertDatabaseAccess: processOwner.assertDatabaseAccess,
    });
    const acquiring = maintenance.run(() =>
      prepareBranchStateDatabaseRemoval(owner.path, assertOwnerCurrent),
    );
    let removal: Awaited<typeof acquiring> | undefined;
    try {
      expect(() => captureBranchStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      await entered.promise;
      expect(reader.database.db.isOpen).toBe(true);
      finish.resolve();
      removal = await acquiring;
      expect(reader.database.db.isOpen).toBe(false);
      expect(owner.db.isOpen).toBe(false);
      removal.assertCurrent();
      expect(() => captureBranchStateDatabaseReadAdmission(owner.path)).toThrow(/closed/);
      removal.release();
      removal = undefined;
      captureBranchStateDatabaseReadAdmission(owner.path).assertCurrent();
    } finally {
      finish.resolve();
      unregister();
      try {
        removal ??= await acquiring;
        removal.release();
        await maintenance.close();
      } finally {
        processOwner.release();
      }
    }
  });
});
