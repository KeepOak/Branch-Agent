import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as branchRoot from "../../infra/branch-root.js";
import { writePackageRoot } from "../../infra/package-update-steps.test-support.js";
import * as controlPlaneSentinel from "../../infra/update-control-plane-sentinel.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { createBranchTestState } from "../../test-utils/branch-test-state.js";

const { CONTROL_PLANE_UPDATE_SENTINEL_META_ENV, readControlPlaneUpdateSentinelMeta } =
  controlPlaneSentinel;

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  root: vi.fn<() => Promise<string>>(),
  resume: vi.fn(),
}));
vi.mock("./update-execution.runtime.js", () => ({ resumePostCoreUpdate: mocks.resume }));
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: (command: string, args: string[], options: import("node:child_process").SpawnOptions) =>
      args[1] === "update"
        ? mocks.spawn(command, args, options)
        : original.spawn(command, args, options),
  };
});
vi.mock("./shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared.js")>()),
  resolveUpdateRoot: mocks.root,
}));
// This boundary test never inspects or changes an operator's service.
vi.mock("./update-command-service-plan.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./update-command-service-plan.js")>()),
  resolveManagedServicePackageUpdatePlan: async () => ({ rootRedirect: null }),
}));

import { continuePostCoreUpdateInFreshProcess } from "./update-command-post-core.js";
import { prepareUpdateCommand } from "./update-command-run.js";
import { updateCommand } from "./update-command.js";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("managed post-core root handoff", () => {
  it.each(["replacement", "foreign-install", "inactive-generation", "pre-core", "moving-link"])(
    "branch update admits the installed driver's original pnpm identity (%s)",
    async (scenario) => {
      const state = await createBranchTestState({ label: "legacy-pnpm-handoff" });
      try {
        await state.writeConfig({});
        const project = state.path("pnpm", "global", "5");
        const previous = path.join(project, ".pnpm", "branch@1.0.0", "node_modules", "branch");
        const current = path.join(project, ".pnpm", "branch@2.0.0", "node_modules", "branch");
        const inactive = path.join(project, ".pnpm", "branch@1.5.0", "node_modules", "branch");
        const foreignProject = state.path("other-pnpm", "global", "5");
        const foreign = path.join(
          foreignProject,
          ".pnpm",
          "branch@2.0.0",
          "node_modules",
          "branch",
        );
        for (const [root, version] of [
          [previous, "1.0.0"],
          [current, "2.0.0"],
          [inactive, "1.5.0"],
          [foreign, "2.0.0"],
        ] as const) {
          await writePackageRoot(root, version);
        }
        const link = path.join(project, "node_modules", "branch");
        const foreignLink = path.join(foreignProject, "node_modules", "branch");
        for (const [owner, target, activeLink] of [
          [project, current, link],
          [foreignProject, foreign, foreignLink],
        ] as const) {
          await fs.mkdir(path.dirname(activeLink), { recursive: true });
          await fs.writeFile(
            path.join(owner, "node_modules", ".modules.yaml"),
            "layoutVersion: 5\n",
          );
          await fs.writeFile(
            path.join(owner, "package.json"),
            JSON.stringify({ dependencies: { branch: "2.0.0" } }),
          );
          await fs.symlink(target, activeLink, process.platform === "win32" ? "junction" : "dir");
        }
        const meta = { root: previous, handoffId: "original-driver" };
        const metaPath = await state.writeJson("sentinel-meta.json", { version: 1, meta });
        vi.spyOn(branchRoot, "resolveBranchPackageRootSync").mockReturnValue(
          scenario === "foreign-install"
            ? foreign
            : scenario === "inactive-generation"
              ? inactive
              : current,
        );
        if (scenario === "moving-link") {
          vi.spyOn(
            controlPlaneSentinel,
            "readControlPlaneUpdateSentinelMeta",
          ).mockImplementationOnce(async (env) => {
            await fs.unlink(link);
            await fs.symlink(inactive, link, process.platform === "win32" ? "junction" : "dir");
            return await readControlPlaneUpdateSentinelMeta(env);
          });
        }
        mocks.root.mockResolvedValue(
          scenario === "foreign-install"
            ? foreignLink
            : scenario === "inactive-generation"
              ? inactive
              : link,
        );
        await withEnvAsync(
          {
            [CONTROL_PLANE_UPDATE_SENTINEL_META_ENV]: metaPath,
            BRANCH_UPDATE_POST_CORE: scenario === "pre-core" ? undefined : "1",
          },
          async () => {
            const command = updateCommand({ yes: true, json: true });
            if (scenario === "replacement") {
              await command;
              expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({ root: link }));
            } else {
              await expect(command).rejects.toThrow("Managed update handoff root mismatch");
              expect(mocks.resume).not.toHaveBeenCalled();
            }
            expect(JSON.parse(await fs.readFile(metaPath, "utf8"))).toEqual({ version: 1, meta });
          },
        );
      } finally {
        await state.cleanup();
      }
    },
  );

  it.each([false, true])(
    "binds pnpm replacement to the activated generation (foreign child=%s)",
    async (foreignChild) => {
      const state = await createBranchTestState({ label: "post-core-root" });
      try {
        await state.writeConfig({});
        const globalRoot = state.path("pnpm", "global", "5", "node_modules");
        const previous = path.join(
          globalRoot,
          ".pnpm",
          "branch@1.0.0",
          "node_modules",
          "branch",
        );
        const next = path.join(globalRoot, ".pnpm", "branch@2.0.0", "node_modules", "branch");
        const root = path.join(globalRoot, "branch");
        await writePackageRoot(previous, "1.0.0");
        await writePackageRoot(next, "2.0.0");
        await fs.symlink(previous, root, process.platform === "win32" ? "junction" : "dir");
        const meta = {
          root: await fs.realpath(root),
          handoffId: "fixture-handoff",
          runId: "fixture-run",
          serviceStoppedAtMs: 123,
          note: "Fixture update",
        };
        const metaPath = await state.writeJson("sentinel-meta.json", { version: 1, meta });
        const executingRoot = vi.spyOn(branchRoot, "resolveBranchPackageRootSync");
        executingRoot.mockReturnValue(previous);
        await withEnvAsync({ [CONTROL_PLANE_UPDATE_SENTINEL_META_ENV]: metaPath }, async () => {
          mocks.root.mockResolvedValue(root);
          await prepareUpdateCommand({ json: true });
          // pnpm keeps the global link name while replacing its versioned target.
          await fs.unlink(root);
          await fs.symlink(next, root, process.platform === "win32" ? "junction" : "dir");
          const foreign = state.path("different-install");
          await writePackageRoot(foreign, "2.0.0");
          executingRoot.mockReturnValue(foreignChild ? foreign : next);
          mocks.root.mockResolvedValue(foreignChild ? foreign : root);
          let childError: unknown;
          let childMeta: Awaited<ReturnType<typeof readControlPlaneUpdateSentinelMeta>> = null;
          mocks.spawn.mockImplementation(
            (_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
              const child = new EventEmitter();
              void withEnvAsync(options.env, async () => {
                childMeta = await readControlPlaneUpdateSentinelMeta();
                await prepareUpdateCommand({ json: true });
              }).then(
                () => {
                  child.emit("exit", 0, null);
                  child.emit("close", 0, null);
                },
                (error: unknown) => {
                  childError = error;
                  child.emit("exit", 1, null);
                  child.emit("close", 1, null);
                },
              );
              return child;
            },
          );
          const result = await continuePostCoreUpdateInFreshProcess({
            root,
            channel: "stable",
            requestedChannel: null,
            opts: { json: true },
            pluginInstallRecords: {},
            updateStartedAtMs: 123,
            timeoutMs: 15_000,
          });
          if (foreignChild) {
            expect(String(childError)).toContain("Managed update handoff root mismatch");
            expect(result).toEqual({ resumed: false, exitCode: 1 });
          } else {
            expect(childError).toBeUndefined();
            expect(result).toEqual({ resumed: true });
          }
          expect(childMeta).toMatchObject({ ...meta, root: await fs.realpath(next) });
          expect(await readControlPlaneUpdateSentinelMeta()).toMatchObject(meta);
          expect(JSON.parse(await fs.readFile(metaPath, "utf8"))).toEqual({ version: 1, meta });
        });
      } finally {
        await state.cleanup();
      }
    },
  );
});
