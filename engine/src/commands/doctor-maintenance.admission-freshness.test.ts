import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createUpdateRun } from "../infra/update-run-ledger.js";
import { recordBranchDatabaseQuarantine } from "../state/branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db-cache.js";
import { withBranchStateDatabaseReadSnapshot } from "../state/branch-state-db-readonly.js";
import { setupDoctorAdmissionFixture } from "./doctor-maintenance.admission.test-support.js";

const fixture = setupDoctorAdmissionFixture();

it("refuses committed WAL updates while preserving all live source artifacts", () => {
  const { env, admission, family, assertIsolation } = fixture(true);
  const before = family();
  admission();
  expect(family()).toEqual(before);
  const competing = createUpdateRun({ trigger: "cli" }, { env });
  const committed = family();
  try {
    expect(() => admission()).toThrow(competing.runId);
    expect(family()).toEqual(committed);
  } finally {
    assertIsolation();
  }
});

it("refuses a competing run after replacement of an already admitted source", () => {
  const { env, database, admission, createStateDir, assertIsolation } = fixture();
  const replacement = createStateDir();
  const competing = createUpdateRun(
    { trigger: "cli" },
    { env: { ...env, BRANCH_STATE_DIR: replacement } },
  );
  closeBranchStateDatabaseForTest();
  fs.renameSync(path.join(replacement, "state", "branch.sqlite"), database);
  try {
    expect(() => admission()).toThrow(competing.runId);
  } finally {
    assertIsolation();
  }
});

it("does not borrow a retained discovery snapshot for current admission", async () => {
  const { env, admission, assertIsolation } = fixture();
  try {
    await withBranchStateDatabaseReadSnapshot(
      async () => {
        const competing = createUpdateRun({ trigger: "cli" }, { env });
        expect(() => admission()).toThrow(competing.runId);
      },
      { env },
    );
  } finally {
    assertIsolation();
  }
});

it("refuses new quarantine even when the admitted ledger bytes are unchanged", () => {
  const { env, database, admission, family, assertIsolation } = fixture();
  const before = family();
  expect(
    recordBranchDatabaseQuarantine({
      env,
      kind: "state",
      path: database,
      reason: "fresh quarantine refusal",
    }),
  ).toBe(true);
  try {
    expect(() => admission()).toThrow("fresh quarantine refusal");
    expect(family()).toEqual(before);
  } finally {
    assertIsolation();
  }
});
