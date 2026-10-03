import path from "node:path";
import { withTempHome as withBaseTempHome } from "branch/plugin-sdk/test-env";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { requesterMcpOAuthIdentity } from "./mcp-oauth-identity.js";

const REQUESTER_SCOPE = { messageChannel: "telegram", agentAccountId: "bot" } as const;

export function requesterIdentity(
  serverName: string,
  serverUrl: string,
  requesterSenderId: string,
) {
  return requesterMcpOAuthIdentity(serverName, serverUrl, {
    ...REQUESTER_SCOPE,
    requesterSenderId,
  });
}

export async function withTempHome<T>(
  run: (home: string) => T | Promise<T>,
  options: Parameters<typeof withBaseTempHome>[1],
): Promise<T> {
  return withBaseTempHome(async (home) => {
    const previousStateDir = process.env.BRANCH_STATE_DIR;
    process.env.BRANCH_STATE_DIR = path.join(home, ".branch");
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();
    try {
      return await run(home);
    } finally {
      await closeBranchStateDatabaseAsync();
      closeBranchStateDatabaseForTest();
      if (previousStateDir === undefined) {
        delete process.env.BRANCH_STATE_DIR;
      } else {
        process.env.BRANCH_STATE_DIR = previousStateDir;
      }
    }
  }, options);
}
