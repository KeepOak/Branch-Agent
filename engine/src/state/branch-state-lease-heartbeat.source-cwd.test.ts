import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { closeBranchStateDatabaseByPath } from "./branch-state-db-cache.js";
import { openBranchStateDatabase } from "./branch-state-db.js";

it("starts the real source heartbeat from a foreign cwd using the selected tsconfig", async () => {
  await withBranchTestState({ label: "heartbeat-source-cwd" }, async (state) => {
    const databasePath = openBranchStateDatabase({ env: state.env }).path;
    closeBranchStateDatabaseByPath(databasePath);
    await withTempDir("heartbeat-source-cwd-", async (cwd) => {
      const leaseModule = new URL("./branch-state-lease.ts", import.meta.url).href;
      const databaseModule = new URL("./branch-state-db.ts", import.meta.url).href;
      const script = `
        import assert from "node:assert/strict";
        import { withBranchStateLease } from ${JSON.stringify(leaseModule)};
        import { openBranchStateDatabase, closeBranchStateDatabaseForTest } from ${JSON.stringify(databaseModule)};
        try {
          await withBranchStateLease({
            scope: "core:heartbeat-source-cwd", key: "source",
            database: { scope: "shared", options: { env: process.env } },
            leaseMs: 10000, waitMs: 0, heartbeat: "worker",
          }, async (lease) => { lease.assertOwned(); });
          const { db } = openBranchStateDatabase({ env: process.env });
          assert.equal(db.prepare("SELECT count(*) AS n FROM state_leases WHERE scope = ?")
            .get("core:heartbeat-source-cwd").n, 0);
          console.log("heartbeat settled");
        } finally { closeBranchStateDatabaseForTest(); }
      `;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          fileURLToPath(new URL("../../scripts/tsx.mjs", import.meta.url)),
          "--input-type=module",
          "--eval",
          script,
        ],
        {
          cwd,
          env: {
            ...state.env,
            TSX_TSCONFIG_PATH: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
          },
          timeout: 30000,
        },
      );
      expect(stdout.trim()).toBe("heartbeat settled");
    });
  });
});
