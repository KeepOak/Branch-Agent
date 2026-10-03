import path from "node:path";
import type { GatewayLockOptions } from "../infra/gateway-lock.js";

export function createLocalGatewayLockOptions(
  stateDir: string,
  overrides: Partial<GatewayLockOptions> = {},
): GatewayLockOptions {
  return {
    allowInTests: true,
    env: {
      ...process.env,
      BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
      BRANCH_STATE_DIR: stateDir,
    },
    lockDir: path.join(stateDir, "gateway-locks"),
    timeoutMs: 100,
    ...overrides,
  };
}
