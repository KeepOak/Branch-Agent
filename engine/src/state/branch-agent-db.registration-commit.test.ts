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
  return { env, shared, target, admission, receipt, registrations };
}

function observeStores(database: ReturnType<typeof openBranchStateDatabase>) {
  const trace: Array<{ kind: "commit" | "stores"; inTransaction: boolean }> = [];
  const stop = sessionChanges.subscribe((change) => {
    if (isSessionStoreTopologyChange(change)) {
      trace.push({ kind: "stores", inTransaction: database.db.isTransaction });
    }
  });
  subscriptions.add(stop);
  return { trace, stop };
}

describe("agent registration commit publication", () => {
  it("records a registration witness only after outer COMMIT and before topology observers", () => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const witness = vi.fn((_receipt: BranchAgentDatabaseRegistrationCommit) => {
      trace.push({ kind: "commit", inTransaction: fixture.shared.db.isTransaction });
    });

    runBranchStateWriteTransaction(
      () => {
        registerBranchAgentDatabase(fixture.target, { committed: witness });
        expect(witness).not.toHaveBeenCalled();
        expect(trace).toEqual([]);
      },
      { env: fixture.env },
    );

    expect(witness).toHaveBeenCalledExactlyOnceWith(fixture.receipt);
    expect(trace).toEqual([
      { kind: "commit", inTransaction: false },
      { kind: "stores", inTransaction: false },
    ]);
    expect(fixture.registrations()).toEqual([
      expect.objectContaining({ agentId: fixture.target.agentId, path: fixture.target.path }),
    ]);
  });

  it("invalidates lazy registry snapshots across worker registration settlement", async () => {
    const fixture = createFixture();
    const prepared = registryListing.prepareBranchAgentDatabaseRegistrySnapshotRead({
      env: fixture.env,
    });
    const before = await prepared.read();
    expect(before.result).toEqual({ status: "available", entries: [] });
    const registration = registryListing.captureBranchAgentDatabaseRegistration({
      agentId: fixture.target.agentId,
      agentPath: fixture.target.path,
      admission: fixture.admission,
    });

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

  it("discards the registration witness and topology publication on outer rollback", () => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const witness = vi.fn();
    const rollback = new Error("rollback registration fixture");

    expect(() =>
      runBranchStateWriteTransaction(
        () => {
          registerBranchAgentDatabase(fixture.target, { committed: witness });
          expect(witness).not.toHaveBeenCalled();
          expect(trace).toEqual([]);
          throw rollback;
        },
        { env: fixture.env },
      ),
    ).toThrow(rollback);

    expect(witness).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
    expect(fixture.registrations()).toEqual([]);
  });

  it("does not witness or publish an import-artifact registration no-op", () => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const witness = vi.fn();
    const starting = vi.fn();

    registerBranchAgentDatabase(
      {
        ...fixture.target,
        path: path.join(fixture.env.BRANCH_STATE_DIR, "imports", "copy.sqlite"),
      },
      { starting, committed: witness },
    );

    expect(starting).not.toHaveBeenCalled();
    expect(witness).not.toHaveBeenCalled();
    expect(trace).toEqual([]);
    expect(fixture.registrations()).toEqual([]);
  });

  it("refuses registration before writing when its start observer rejects", () => {
    const fixture = createFixture();
    const { trace } = observeStores(fixture.shared);
    const refused = new Error("Registration source revoked before its write");
    const committed = vi.fn();
    expect(() =>
      registerBranchAgentDatabase(fixture.target, {
        starting() {
          throw refused;
        },
        committed,
      }),
    ).toThrow(refused);
    expect(committed).not.toHaveBeenCalled();
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
      const registration = registryListing.captureBranchAgentDatabaseRegistration({
        agentId: fixture.target.agentId,
        agentPath: fixture.target.path,
        admission: fixture.admission,
      });
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
