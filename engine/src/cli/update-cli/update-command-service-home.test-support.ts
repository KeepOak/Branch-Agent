import fs from "node:fs/promises";
import path from "node:path";
import { expect, vi } from "vitest";
import * as branchTmp from "../../infra/tmp-branch-dir.js";
import { resolveManagedUpdateLeaseDatabasePath } from "../../infra/update-managed-service-handoff-lease.js";
import { withTestDir } from "../../test-helpers/temp-dir.js";
import { withEnvAsync } from "../../test-utils/env.js";

export async function withServiceHome(run: (home: string) => Promise<void>): Promise<void> {
  await withTestDir({ prefix: "branch-update-service-" }, async (home) => {
    const temporary = vi.spyOn(branchTmp, "resolvePreferredBranchTmpDir").mockReturnValue(home);
    try {
      const databasePath = resolveManagedUpdateLeaseDatabasePath();
      expect(databasePath).toBe(path.join(home, "managed-update-handoffs.sqlite"));
      expect(await fs.realpath(path.dirname(databasePath))).toBe(home);
      await withEnvAsync(
        {
          HOME: home,
          USERPROFILE: home,
          APPDATA: path.join(home, "AppData"),
          BRANCH_GATEWAY_PORT: undefined,
          BRANCH_HOME: undefined,
          BRANCH_STATE_DIR: undefined,
          BRANCH_CONFIG_PATH: undefined,
          BRANCH_PROFILE: undefined,
          BRANCH_SUPERVISOR_MODE: undefined,
          BRANCH_SERVICE_MARKER: undefined,
          BRANCH_SERVICE_KIND: undefined,
        },
        () => run(home),
      );
    } finally {
      temporary.mockRestore();
    }
  });
}
