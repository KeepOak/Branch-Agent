import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createRetainedOperation } from "@branch/worker-runtime/lifecycle";
import { afterEach, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { tableHasColumn } from "./branch-state-db-schema-helpers.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "./branch-state-db.js";
import type { BranchStateReadOutcome } from "./branch-state-read.types.js";
import { readUserProfileVersion } from "./user-profile-events.js";
import {
  getUserProfileDisplay,
  readUserProfileIdentity,
  retainUserProfileCatalog,
} from "./user-profile-list.js";
import { setUserProfileRole } from "./user-profile-writes.worker.js";
import { getProfileAvatar } from "./user-profiles-avatar.test-support.js";
import {
  adoptTailscaleProfileAvatar,
  ensureProfileForEmail,
  UserProfileNotFoundError,
} from "./user-profiles.js";

const boundary = vi.hoisted(() => ({
  beforeOperation: undefined as (() => void) | undefined,
  afterResult: undefined as (() => void) | undefined,
  duringGrant: undefined as (() => void) | undefined,
  bindFailure: undefined as Error | undefined,
  readFailure: undefined as Error | undefined,
  identityFailure: undefined as Error | undefined,
}));
vi.mock("../infra/sqlite-worker-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/sqlite-worker-identity.js")>();
  return {
    ...actual,
    assertExistingDatabaseIdentity: (
      ...args: Parameters<typeof actual.assertExistingDatabaseIdentity>
    ) => {
      if (boundary.identityFailure) {
        throw boundary.identityFailure;
      }
      actual.assertExistingDatabaseIdentity(...args);
    },
  };
});
vi.mock("./branch-state-worker-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./branch-state-worker-store.js")>();
  return {
    ...actual,
    runBranchStateWorkerOperation: (
      context: Parameters<typeof actual.runBranchStateWorkerOperation>[0],
      operation: Parameters<typeof actual.runBranchStateWorkerOperation>[1],
      options: Parameters<typeof actual.runBranchStateWorkerOperation>[2],
    ) => {
      boundary.beforeOperation?.();
      return actual.runBranchStateWorkerOperation(
        context,
        (scope) =>
          operation({
            execute: async (command, executeOptions) => {
              const result = await scope.execute(command, executeOptions);
              if (command.type === "userProfiles.avatar.adopt") {
                boundary.afterResult?.();
              }
              return result;
            },
          }),
        options,
      );
    },
  };
});
vi.mock("./user-profile-list.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./user-profile-list.js")>();
  return {
    ...actual,
    retainUserProfileMutationPublication: (
      ...args: Parameters<typeof actual.retainUserProfileMutationPublication>
    ) => {
      const publication = actual.retainUserProfileMutationPublication(...args);
      try {
        boundary.duringGrant?.();
      } catch (error) {
        publication.release();
        throw error;
      }
      return publication;
    },
  };
});
vi.mock("./branch-state-settlement-read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./branch-state-settlement-read.js")>();
  return {
    ...actual,
    withBranchStateSettlementRead: (
      context: Parameters<typeof actual.withBranchStateSettlementRead>[0],
      operation: Parameters<typeof actual.withBranchStateSettlementRead>[1],
    ) =>
      actual.withBranchStateSettlementRead(context, (read) =>
        operation({
          ...read,
          bind: (...args: Parameters<typeof read.bind>) => {
            if (boundary.bindFailure) {
              throw boundary.bindFailure;
            }
            read.bind(...args);
          },
        }),
      ),
  };
});
vi.mock("./branch-state-read-worker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./branch-state-read-worker.js")>();
  return {
    ...actual,
    captureBranchStateReadSource: () => {
      const source = actual.captureBranchStateReadSource();
      return {
        ...source,
        createTransport: (...args: Parameters<typeof source.createTransport>) => {
          const owned = source.createTransport(...args);
          return {
            ...owned,
            startRead: (...readArgs: Parameters<typeof owned.startRead>) => {
              if (boundary.readFailure) {
                const completion = createRetainedOperation<BranchStateReadOutcome>(() => {});
                completion.reject(boundary.readFailure);
                return completion.operation;
              }
              return owned.startRead(...readArgs);
            },
          };
        },
      };
    },
  };
});
afterEach(() => {
  boundary.beforeOperation = undefined;
  boundary.afterResult = undefined;
  boundary.duringGrant = undefined;
  boundary.bindFailure = undefined;
  boundary.readFailure = undefined;
  boundary.identityFailure = undefined;
  vi.restoreAllMocks();
});

function fetchedAvatar() {
  const bytes = readFileSync(join(process.cwd(), "ui/public/favicon-32.png"));
  return {
    fetchImpl: vi.fn(
      async () =>
        new Response(Uint8Array.from(bytes).buffer, { headers: { "content-type": "image/png" } }),
    ),
  };
}

function adoptAvatar(profileId: string) {
  return adoptTailscaleProfileAvatar(
    profileId,
    "https://avatars.example.test/p",
    {},
    fetchedAvatar(),
  );
}

it("checks original source identity before publishing an acknowledged avatar receipt", async () => {
  const state = await createBranchTestState({
    layout: "state-only",
    prefix: "avatar-receipt-identity-",
  });
  let release = () => {};
  let closing: Promise<unknown> | undefined;
  try {
    const profile = ensureProfileForEmail("receipt-identity@example.test");
    const pathname = openBranchStateDatabase().path;
    release = retainUserProfileCatalog();
    boundary.afterResult = () => {
      boundary.identityFailure = new Error("synthetic source identity changed after commit");
      closing = closeBranchStateDatabaseByPathAsync(pathname);
      void closing.catch(() => {});
    };
    await expect(adoptAvatar(profile.id)).rejects.toThrow();
    await expect(closing).rejects.toThrow("identity changed");
    expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(false);
    boundary.identityFailure = undefined;
    await closeBranchStateDatabaseByPathAsync(pathname);
    expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(true);
    expect(getProfileAvatar(profile.id)).toBeDefined();
  } finally {
    boundary.identityFailure = undefined;
    await Promise.allSettled([closing]);
    release();
    await state.cleanup();
  }
});

it("preserves a native first-use role in avatar publication after warming a legacy worker", async () => {
  const state = await createBranchTestState({
    layout: "state-only",
    prefix: "avatar-legacy-role-",
  });
  let release = () => {};
  try {
    const { db } = openBranchStateDatabase();
    db.exec(`CREATE TABLE user_profiles (
      id TEXT NOT NULL PRIMARY KEY, display_name TEXT, avatar BLOB, avatar_mime TEXT,
      avatar_sha256 TEXT, merged_into TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT`);
    const profile = ensureProfileForEmail("legacy-avatar@example.test");
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    await adoptTailscaleProfileAvatar(profile.id, undefined);
    expect(tableHasColumn(db, "user_profiles", "role")).toBe(false);
    setUserProfileRole(profile.id, "reader");
    release = retainUserProfileCatalog();
    const adopted = await adoptAvatar(profile.id);
    expect(adopted.role).toBe("reader");
    expect(readUserProfileIdentity(profile.id)?.role).toBe("reader");
    expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(true);
    expect(db.prepare("PRAGMA user_version").get()?.user_version).toBe(version);
  } finally {
    release();
    await state.cleanup();
  }
});

it.each(["missing profile", "closed before dispatch", "binding refusal"] as const)(
  "releases avatar admission after %s",
  async (failure) => {
    const state = await createBranchTestState({
      layout: "state-only",
      prefix: "avatar-admission-refusal-",
    });
    let closing: Promise<unknown> | undefined;
    let release = () => {};
    try {
      const profile = ensureProfileForEmail("closed@example.test");
      const pathname = openBranchStateDatabase().path;
      const version = readUserProfileVersion();
      if (failure === "missing profile") {
        await expect(
          adoptTailscaleProfileAvatar("missing-profile", undefined),
        ).rejects.toBeInstanceOf(UserProfileNotFoundError);
      } else {
        if (failure === "closed before dispatch") {
          boundary.beforeOperation = () => {
            closing = closeBranchStateDatabaseByPathAsync(pathname);
          };
        } else {
          release = retainUserProfileCatalog();
          boundary.bindFailure = new Error("synthetic binding refusal");
        }
        await expect(adoptAvatar(profile.id)).rejects.toThrow(
          failure === "closed before dispatch" ? "closed" : "synthetic binding refusal",
        );
        await closing;
      }
      expect(getProfileAvatar(profile.id)).toBeUndefined();
      if (failure === "binding refusal") {
        expect(readUserProfileVersion()).toBe(version);
        release();
        const prepare = vi.spyOn(requireNodeSqlite().DatabaseSync.prototype, "prepare");
        expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(false);
        expect(prepare).toHaveBeenCalled();
        prepare.mockRestore();
      }
    } finally {
      await closing;
      release();
      await state.cleanup();
    }
  },
);

it.each([false, true])(
  "publishes to a catalog retained before commit (previous catalog=%s)",
  async (resident) => {
    const state = await createBranchTestState({
      layout: "state-only",
      prefix: "avatar-precommit-catalog-",
    });
    let release = () => {};
    try {
      const profile = ensureProfileForEmail("precommit@example.test");
      if (resident) {
        release = retainUserProfileCatalog();
      }
      let prepared = false;
      boundary.duringGrant = () => {
        release();
        release = retainUserProfileCatalog();
        expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(false);
        prepared = true;
      };
      await adoptAvatar(profile.id);
      expect(prepared).toBe(true);
      expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(true);
      expect(readUserProfileIdentity(profile.id)?.profileId).toBe(profile.id);
    } finally {
      release();
      await state.cleanup();
    }
  },
);

it("refuses a replacement source during settlement and retries only the original inode", async () => {
  const state = await createBranchTestState({
    layout: "state-only",
    prefix: "avatar-source-replacement-",
  });
  let release = () => {};
  let closing: Promise<unknown> | undefined;
  let pathname: string | undefined;
  let saved: string | undefined;
  try {
    const profile = ensureProfileForEmail("replacement@example.test");
    pathname = openBranchStateDatabase().path;
    saved = `${pathname}.original`;
    release = retainUserProfileCatalog();
    await closeBranchStateDatabaseByPathAsync(pathname);
    boundary.readFailure = new Error("synthetic initial reconciliation failure");
    boundary.afterResult = () => {
      closing = closeBranchStateDatabaseByPathAsync(pathname!);
      void closing.catch(() => {});
      throw new Error("synthetic result delivery failure");
    };
    await expect(adoptAvatar(profile.id)).rejects.toThrow();
    await expect(closing).rejects.toThrow();
    // The writer has exited; simulate an out-of-band replacement of task-owned bytes.
    renameSync(pathname, saved);
    copyFileSync(saved, pathname);
    const replacement = readFileSync(pathname);
    boundary.readFailure = undefined;
    await expect(closeBranchStateDatabaseByPathAsync(pathname)).rejects.toThrow(
      "identity changed",
    );
    expect(readFileSync(pathname)).toEqual(replacement);
    expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(false);
    unlinkSync(pathname);
    renameSync(saved, pathname);
    await closeBranchStateDatabaseByPathAsync(pathname);
    expect(getUserProfileDisplay(profile.id).hasAvatar).toBe(true);
    expect(getProfileAvatar(profile.id)).toBeDefined();
  } finally {
    boundary.readFailure = undefined;
    if (pathname && saved && existsSync(saved)) {
      if (existsSync(pathname)) {
        unlinkSync(pathname);
      }
      renameSync(saved, pathname);
    }
    await Promise.allSettled([closing]);
    release();
    await state.cleanup();
  }
});
