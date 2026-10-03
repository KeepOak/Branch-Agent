// Keep the OAuth source-lock fixture separate from the private-handle retirement matrix.
import { expect, vi } from "vitest";
import { operatorMcpOAuthIdentity } from "../agents/mcp-oauth-identity.js";
import { resolveMcpOAuthAccessToken } from "../agents/mcp-oauth.js";
import type { HealthCheck } from "../flows/health-checks.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import type { RuntimeEnv } from "../runtime.js";
import { closeBranchStateDatabaseByPathAsync } from "../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { runDoctorLintCli } from "./doctor-lint.js";
import {
  seedDoctorLintMcpToken,
  snapshotDoctorLintSqliteFamily,
} from "./doctor-lint.test-support.js";

export async function verifyDoctorLintOAuthStateIsolation(
  runtime: RuntimeEnv,
  installHealthChecks: (checks: HealthCheck[]) => void,
): Promise<void> {
  await withBranchTestState({ prefix: "doctor-lint-oauth-" }, async (state) => {
    await state.writeConfig({});
    const identity = operatorMcpOAuthIdentity("oauth-proof", "https://mcp.example.test/rpc");
    await seedDoctorLintMcpToken(identity);
    const databasePath = resolveBranchStateSqlitePath(state.env);
    await closeBranchStateDatabaseByPathAsync(databasePath);
    const lock = openNodeSqliteDatabase(databasePath);
    try {
      // Materialize the caller's WAL sidecars before measuring Doctor's effects.
      // Windows byte-range locks prohibit raw snapshots during the transaction.
      lock.exec("BEGIN IMMEDIATE; ROLLBACK");
      const before = snapshotDoctorLintSqliteFamily(databasePath);
      lock.exec("BEGIN IMMEDIATE");
      let resolvedToken: string | undefined;
      installHealthChecks([
        {
          id: "core/doctor/runtime-tool-schemas",
          kind: "core",
          description: "checks OAuth state ownership",
          async detect() {
            return await withDoctorLintOAuthWorker(databasePath, async () => {
              resolvedToken = await resolveMcpOAuthAccessToken({
                identity,
                acceptUnknownExpiry: true,
              });
              return [];
            });
          },
        },
      ]);
      const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        const exitCode = await runDoctorLintCli(runtime, {
          json: true,
          onlyIds: ["core/doctor/runtime-tool-schemas"],
        });
        expect(exitCode, String(stdout.mock.calls.at(-1)?.[0])).toBe(0);
        const report = JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
        expect(report).toMatchObject({
          ok: true,
          checksRun: 1,
          findings: [],
        });
        expect(report.warnings ?? []).toEqual([]);
        expect(resolvedToken).toBe("stored-inspection-token-not-real");
        expect(lock.isOpen).toBe(true);
        expect(lock.isTransaction).toBe(true);
        lock.exec("ROLLBACK");
        expect(snapshotDoctorLintSqliteFamily(databasePath)).toEqual(before);
      } finally {
        stdout.mockRestore();
      }
    } finally {
      if (lock.isTransaction) {
        lock.exec("ROLLBACK");
      }
      lock.close();
      await closeBranchStateDatabaseByPathAsync(databasePath);
    }
  });
}

async function withDoctorLintOAuthWorker<T>(
  sourceDatabasePath: string,
  inspect: () => Promise<T>,
): Promise<T> {
  const context = captureBranchStateWorkerContext();
  expect(context.admission.databasePath).toBe(resolveBranchStateSqlitePath(process.env));
  expect(context.admission.databasePath).not.toBe(sourceDatabasePath);
  return await runBranchStateWorkerOperation(context, inspect);
}
