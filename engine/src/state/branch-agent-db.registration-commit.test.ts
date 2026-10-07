import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { isSessionStoreTopologyChange, sessionChanges } from "../sessions/session-row-changes.js";
import type { BranchAgentDatabaseRegistrationCommit } from "./branch-agent-db-contract.js";
import * as registryListing from "./branch-agent-db-registry-listing.js";
import { registerBranchAgentDatabase } from "./branch-agent-db-registry.js";
import * as validation from "./branch-agent-db-validation-cache.js";
import {
  closeBranchAgentDatabaseByPathAsync,
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.js";
import {
  captureBranchStateDatabaseReadAdmission,
  closeBranchStateDatabaseAsync,
} from "./branch-state-db-cache.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "./branch-state-db.js";

const subscriptions = new Set<() => void>();
const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    for (const stop of subscriptions) {
      stop();
    }
    subscriptions.clear();
    vi.restoreAllMocks();
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    cleanup();
  }),
);

function createFixture() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-registration-commit-") };
  const shared = openBranchStateDatabase({ env });
  const options = { agentId: "registration-commit", env };
  const target = { ...options, path: resolveBranchAgentSqlitePath(options) };
  const admission = captureBranchStateDatabaseReadAdmission(shared.path);
  const receipt: BranchAgentDatabaseRegistrationCommit = {
    agentId: target.agentId,
    agentPath: target.path,
    stateDatabasePath: shared.path,
    stateDatabaseIdentity: admission.identity.key,
  };
  const registrations = () => registryListing.readRegisteredAgentDatabases({ env }, false);
  const capture = (
    overrides: Partial<
      Parameters<typeof registryListing.captureBranchAgentDatabaseRegistration>[0]
    > = {},
  ) =>
    registryListing.captureBranchAgentDatabaseRegistration({
      agentId: target.agentId,
      agentPath: target.path,
      admission,
      ...overrides,
    });
  return { env, shared, target, admission, receipt, registrations, capture };
}

function observeStores(database: ReturnType<typeof openBranchStateDatabase>) {
  const trace: Array<{ kind: "commit" | "stores"; inTransaction: boolean }> = [];
  const facts: boolean[] = [];
  subscriptions.add(
    sessionChanges.subscribeFacts((change) => {
      if (isSessionStoreTopologyChange(change)) {
        facts.push(registryListing.isBranchAgentDatabaseRegistryChange(change));
      }
    }),
  );
  const stop = sessionChanges.subscribe((change) => {
    if (isSessionStoreTopologyChange(change)) {
      trace.push({ kind: "stores", inTransaction: database.db.isTransaction });
    }
  });
  subscriptions.add(stop);
  return { trace, stop, facts };
}

describe("agent registration commit publication", () => {
  it.each([false, true])(
    "clears pre-activation pending registration (admission throws=%s)",
    async (throws) => {
      const fixture = createFixture();
      const assertCurrent = vi.fn(() => fixture.admission.assertCurrent());
      const registration = fixture.capture({ admission: { ...fixture.admission, assertCurrent } });
      registration.begin();
      if (throws) {
        assertCurrent.mockImplementation(() => {
          throw new Error("existing schema scope ended");
        });
        expect(() => registration.finish()).toThrow("existing schema scope ended");
      }
      const prepared = registryListing.prepareBranchAgentDatabaseRegistrySnapshotRead(
        { env: fixture.env },
        () => false,
      );
      try {
        if (!throws) {
          await expect(prepared.read()).rejects.toThrow("ownership is changing");
        }
      } finally {
        registration.finish();
      }
      const after = await prepared.read();
      expect(after.result).toEqual({ status: "available", entries: [] });
      expect(after.assertCurrent).not.toThrow();
    },
  );

  it.each([false, true])(
    "requires following the owned registration commit (follow=%s)",
    async (followCommit) => {
      const fixture = createFixture();
      const snapshot = await registryListing
        .prepareBranchAgentDatabaseRegistrySnapshotRead({ env: fixture.env }, () => false)
        .read();
      let follow = true;
      const registration = fixture.capture({
        onRegistryChange: (change) => {
          if (follow) {
            snapshot.followRegistration(change);
          }
        },
      });
      const other = fixture.capture({
        agentId: "other",
        agentPath: `${fixture.target.path}.other`,
      });
      try {
        registration.begin();
        expect(snapshot.assertCurrent).not.toThrow();
        other.begin();
        expect(snapshot.assertCurrent).toThrow("ownership is changing");
        other.finish();
        expect(snapshot.assertCurrent).not.toThrow();
        follow = followCommit;
        registration.recordCommitted(fixture.receipt);
        if (followCommit) {
          expect(snapshot.assertCurrent).not.toThrow();
        } else {
          expect(snapshot.assertCurrent).toThrow("registry changed");
        }
        registration.finish();
        if (followCommit) {
          expect(snapshot.assertCurrent).not.toThrow();
        }
      } finally {
        other.finish();
        registration.finish();
      }
    },
  );

  it.each(["COMMIT", "ROLLBACK"])(
    "settles registration witnesses and topology after outer %s",
    (outcome) => {
      const fixture = createFixture();
      const { trace, facts } = observeStores(fixture.shared);
      const witness = vi.fn((_receipt: BranchAgentDatabaseRegistrationCommit) => {
        trace.push({ kind: "commit", inTransaction: fixture.shared.db.isTransaction });
      });

      const rollback = new Error("rollback registration fixture");
      const write = () =>
        runBranchStateWriteTransaction(
          () => {
            registerBranchAgentDatabase(fixture.target, { committed: witness });
            expect(witness).not.toHaveBeenCalled();
            expect(trace).toEqual([]);
            expect(facts).toEqual([]);
            if (outcome === "ROLLBACK") {
              throw rollback;
            }
          },
          { env: fixture.env },
        );

      if (outcome === "ROLLBACK") {
        expect(write).toThrow(rollback);
        expect(witness).not.toHaveBeenCalled();
        expect(trace).toEqual([]);
        expect(facts).toEqual([]);
        expect(fixture.registrations()).toEqual([]);
        return;
      }
      write();
      expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
      expect(facts).toEqual([true]);
      expect(trace).toEqual([
        { kind: "commit", inTransaction: false },
        { kind: "stores", inTransaction: false },
      ]);
      expect(fixture.registrations()).toEqual([
        expect.objectContaining({ agentId: fixture.target.agentId, path: fixture.target.path }),
      ]);
    },
  );

  it("invalidates lazy registry snapshots across worker registration settlement", async () => {
    const fixture = createFixture();
    const prepared = registryListing.prepareBranchAgentDatabaseRegistrySnapshotRead({
      env: fixture.env,
    });
    const before = await prepared.read();
    expect(before.result).toEqual({ status: "available", entries: [] });
    const registration = fixture.capture();

    registration.begin();
    expect(before.assertCurrent).toThrow("registry changed");
    expect(prepared.assertCurrent).toThrow("registry changed");
    const during = await prepared.read();
    prepared.assertCurrent();
    expect(before.assertCurrent).toThrow("registry changed");
    expect(during.result).toEqual({ status: "available", entries: [] });
    registerBranchAgentDatabase(fixture.target, {
      committed: (receipt) => registration.recordCommitted(receipt),
    });
    expect(during.assertCurrent).toThrow("registry changed");
    const committed = await prepared.read();
    committed.assertCurrent();
    registration.finish();

    expect(committed.assertCurrent).toThrow("registry changed");
    const after = await prepared.read();
    after.assertCurrent();
    expect(after.result).toEqual({
      status: "available",
      entries: [
        expect.objectContaining({ agentId: fixture.target.agentId, path: fixture.target.path }),
      ],
    });
  });

  it.each(["import artifact", "revoked start"])("does not register or publish a %s", (reason) => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const witness = vi.fn();
    const refused = new Error("Registration source revoked before its write");
    const starting = vi.fn(() => {
      throw refused;
    });
    const register = () =>
      registerBranchAgentDatabase(
        reason === "import artifact"
          ? {
              ...fixture.target,
              path: path.join(fixture.env.BRANCH_STATE_DIR, "imports", "copy.sqlite"),
            }
          : fixture.target,
        { starting, committed: witness },
      );

    if (reason === "import artifact") {
      register();
      expect(starting).not.toHaveBeenCalled();
    } else {
      expect(register).toThrow(refused);
    }
    expect(witness).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
    expect(fixture.registrations()).toEqual([]);
  });

  it("does not repeat a registration witness for a cache hit or validated reopen", async () => {
    const fixture = createFixture();
    const witness = vi.fn();
    const opened = openBranchAgentDatabase(fixture.target, undefined, { committed: witness });
    expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
    const before = fixture.registrations();
    const { trace } = observeStores(fixture.shared);

    expect(openBranchAgentDatabase(fixture.target, undefined, { committed: witness })).toBe(
      opened,
    );
    await closeBranchAgentDatabaseByPathAsync(fixture.target.path, fixture.target.agentId);
    expect(opened.db.isOpen).toBe(false);
    const reopened = openBranchAgentDatabase(fixture.target, undefined, { committed: witness });

    expect(reopened.db === opened.db).toBe(false);
    expect(reopened.db.isOpen).toBe(true);
    expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
    expect(trace).toEqual([]);
    expect(fixture.registrations()).toEqual(before);
  });

  it("retains the registration witness when validation publication fails after COMMIT", () => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const witness = vi.fn();
    const failure = new Error("validation publication failed after registration");
    vi.spyOn(validation, "setBranchAgentDatabaseValidation").mockImplementationOnce(() => {
      throw failure;
    });

    expect(() =>
      openBranchAgentDatabase(fixture.target, undefined, { committed: witness }),
    ).toThrow(failure);

    expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
    expect(trace).toEqual([{ kind: "stores", inTransaction: false }]);
    expect(fixture.registrations()).toEqual([
      expect.objectContaining({ agentId: fixture.target.agentId, path: fixture.target.path }),
    ]);
  });

  it.each([false, true])(
    "publishes a real committed receipt only to its original shared generation (retired=%s)",
    async (retired) => {
      const fixture = createFixture();
      const registration = fixture.capture();
      const local = observeStores(fixture.shared);
      registration.begin();
      const witness = vi.fn((receipt: BranchAgentDatabaseRegistrationCommit) => {
        registration.recordCommitted(receipt);
      });
      registerBranchAgentDatabase(fixture.target, { committed: witness });
      expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
      expect(local.trace).toEqual([{ kind: "stores", inTransaction: false }]);
      local.stop();

      if (retired) {
        await closeBranchStateDatabaseAsync();
        expect(() => fixture.admission.assertCurrent()).toThrow();
      }
      const current = openBranchStateDatabase({ env: fixture.env });
      const parent = observeStores(current);
      registration.finish();
      registration.finish();

      expect(parent.trace).toEqual(retired ? [] : [{ kind: "stores", inTransaction: false }]);
      expect(fixture.registrations()).toEqual([
        expect.objectContaining({ agentId: fixture.target.agentId, path: fixture.target.path }),
      ]);
    },
  );
});
