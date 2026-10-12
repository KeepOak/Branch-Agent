// Verifies chat-facing CLI snippets execute the Branch Agent CLI even from harness-hosted gateways.
import { expectDefined } from "@branch/normalization-core";
import { describe, expect, it } from "vitest";
import {
  createSourceCliFixture,
  runSourceCliProbe,
  withSourceCliParent,
} from "../../infra/branch-cli-invocation.test-support.js";
import { withTempDir } from "../../test-utils/temp-dir.js";
import { buildCurrentBranchCliExecRequest } from "./commands-branch-cli.js";

describe("buildCurrentBranchCliExecRequest", () => {
  it("clears inherited Vitest runner environment for CLI child processes", () => {
    const { env } = buildCurrentBranchCliExecRequest([], {
      PATH: "/usr/bin",
      VITEST: "true",
      VITEST_POOL_ID: "pool",
      BRANCH_VITEST_MAX_WORKERS: "1",
    });
    expect(env).toMatchObject({
      VITEST: "",
      VITEST_POOL_ID: "",
      BRANCH_VITEST_MAX_WORKERS: "",
    });
    expect(env).not.toHaveProperty("PATH");
  });

  it("resolves source workspace imports in reconstructed commands outside the checkout", async () => {
    await withTempDir("branch-chat-cli-source-", async (root) => {
      const fixture = await createSourceCliFixture(root);
      const args = ["sessions", "export-trajectory"];
      const { argv, env } = withSourceCliParent(fixture, () =>
        buildCurrentBranchCliExecRequest(args),
      );
      const command = expectDefined(argv[0], "CLI invocation executable");
      const control = runSourceCliProbe(command, argv.slice(1), fixture.checkout, { env });
      expect(control.status, control.stderr).toBe(0);

      const external = runSourceCliProbe(command, argv.slice(1), fixture.callerCwd, { env });
      expect(external.status, external.stderr).toBe(0);
      expect(JSON.parse(external.stdout)).toMatchObject({
        source: "gateway",
        args,
        cwd: fixture.callerCwd,
      });
    });
  });

  it.skipIf(process.platform === "win32")(
    "resolves source workspace imports in a shell-rendered diagnostics command",
    async () => {
      await withTempDir("branch-chat-cli-shell-", async (root) => {
        const fixture = await createSourceCliFixture(root);
        const args = ["gateway", "diagnostics", "export", "--json"];
        const { command, env } = withSourceCliParent(fixture, () =>
          buildCurrentBranchCliExecRequest(args),
        );
        const result = runSourceCliProbe("/bin/sh", ["-c", command], fixture.callerCwd, { env });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          source: "gateway",
          args,
          cwd: fixture.callerCwd,
        });
      });
    },
  );
});
