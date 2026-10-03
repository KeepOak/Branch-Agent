// E2E: a Gateway host without gh rejects authorization before device-code issuance.
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveExecutablePath } from "../src/infra/executable-path.js";
import {
  createBranchTestInstance,
  type BranchTestInstance,
} from "./helpers/branch-test-instance.js";

const TEST_TIMEOUT_MS = 180_000;
const instances: BranchTestInstance[] = [];

afterEach(async () => {
  await Promise.allSettled(instances.splice(0).map((instance) => instance.cleanup()));
});

describe("GitHub CLI authorization preflight", () => {
  it(
    "returns installation guidance through the real CLI and Gateway without requesting a code",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const gatewayPath = path.dirname(process.execPath);
      expect(resolveExecutablePath("gh", { env: { PATH: gatewayPath } })).toBeUndefined();

      const instance = await createBranchTestInstance({
        name: "github-cli-preflight",
        env: { PATH: gatewayPath, BRANCH_PATH_BOOTSTRAPPED: "1" },
      });
      instances.push(instance);
      await instance.startGateway();

      const result = await instance.cli([
        "gateway",
        "call",
        "tools.github.authorize.start",
        "--params",
        '{"scope":"agent","agentId":"main"}',
        "--json",
      ]);

      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain(
        "GitHub CLI (`gh`) is required on the Gateway host. Install it and retry.",
      );
      expect(output).not.toContain("github.com/login/device");
      expect(output).not.toContain("userCode");
    },
  );
});
