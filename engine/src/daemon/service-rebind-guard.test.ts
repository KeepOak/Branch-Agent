import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { isDefaultInstallIdentity } from "../config/paths.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";
import {
  captureGatewayServiceRebind,
  currentGatewayServiceRebindReceipt,
  fingerprintGatewayServiceDefinition,
  withGatewayServiceRebindCapture,
} from "./service-rebind.js";
import type { GatewayServiceCommandConfig, GatewayServiceInstallArgs } from "./service-types.js";
import { resolveGatewayService } from "./service.js";
import { mockSystemAccountHome } from "./service.test-helpers.js";
const leaves = vi.hoisted(() => ({ install: vi.fn(), read: vi.fn(), config: vi.fn() }));
vi.mock("./launchd.js", async (original) => ({
  ...(await original<typeof import("./launchd.js")>()),
  installLaunchAgent: leaves.install,
  readLaunchAgentProgramArguments: leaves.read,
}));
vi.mock("./future-config-guard.js", () => ({ assertFutureConfigActionAllowed: leaves.config }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it.each(["success", "config-revoked", "definition-raced"] as const)(
  "guards the admitted native rebind: %s",
  async (scenario) => {
    const state = await createBranchTestState();
    try {
      mockProcessPlatform("darwin");
      state.applyEnv();
      mockSystemAccountHome();
      for (const key of [
        "BRANCH_HOME",
        "BRANCH_PROFILE",
        "BRANCH_LAUNCHD_LABEL",
        "BRANCH_SYSTEMD_UNIT",
        "BRANCH_WINDOWS_TASK_NAME",
      ]) {
        vi.stubEnv(key, undefined);
      }
      const env = {
        ...state.env,
        BRANCH_HOME: undefined,
        BRANCH_PROFILE: undefined,
        BRANCH_LAUNCHD_LABEL: undefined,
        BRANCH_SYSTEMD_UNIT: undefined,
        BRANCH_WINDOWS_TASK_NAME: undefined,
      };
      expect(isDefaultInstallIdentity(process.env)).toBe(true);
      expect(isDefaultInstallIdentity(env)).toBe(true);
      let current = true;
      let command: GatewayServiceCommandConfig = { programArguments: ["/node", "/A/branch.mjs"] };
      leaves.read.mockImplementation(async () => command);
      leaves.config.mockImplementation(async () => {
        if (scenario === "config-revoked") {
          current = false;
        }
      });
      leaves.install.mockReset();
      leaves.install.mockImplementation(async (args: GatewayServiceInstallArgs) => {
        args.assertCurrent?.();
        expect(args.preserveAutoStart).toBe(true);
        command = { programArguments: args.programArguments };
      });
      const before = await fingerprintGatewayServiceDefinition(command);
      await withGatewayServiceRebindCapture(before, async () => {
        const work = resolveGatewayService().install({
          env,
          stdout: new PassThrough(),
          programArguments: ["/node", "/B/branch.mjs"],
          assertCurrent: () => {
            if (!current) {
              throw new Error("revoked");
            }
          },
          beforeMutation: async () => {
            if (scenario === "definition-raced") {
              command.programArguments.push("--foreign");
            }
          },
        });
        if (scenario === "success") {
          await work;
          expect(leaves.install).toHaveBeenCalledOnce();
          expect(currentGatewayServiceRebindReceipt()).toEqual({
            before,
            after: await fingerprintGatewayServiceDefinition(command),
            mutated: true,
            runtimePinBefore: expect.stringMatching(/^[a-f0-9]{64}$/),
            runtimePinAfter: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
        } else {
          await expect(work).rejects.toThrow(
            scenario === "config-revoked" ? "revoked" : "definition changed before rebind",
          );
          expect(leaves.config).toHaveBeenCalled();
          expect(leaves.install).not.toHaveBeenCalled();
          expect(currentGatewayServiceRebindReceipt()).toBeUndefined();
        }
      });
    } finally {
      await state.cleanup();
    }
  },
);
it("ordinary native installation retains its default enable behavior", async () => {
  const mutate = vi.fn(async (preserveAutoStart: boolean) => preserveAutoStart);
  await expect(
    captureGatewayServiceRebind(
      async () => null,
      () => undefined,
      mutate,
    ),
  ).resolves.toBe(false);
  expect(mutate).toHaveBeenCalledWith(false);
});
