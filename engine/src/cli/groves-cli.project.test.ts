import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const mocks = vi.hoisted(() => {
  const payloads: unknown[] = [];
  return {
    payloads,
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      writeJson: vi.fn((value: unknown) => payloads.push(value)),
      writeStdout: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`__exit__:${code}`);
      }),
    },
  };
});

vi.mock("../runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../runtime.js")>("../runtime.js")),
  defaultRuntime: mocks.runtime,
  writeRuntimeJson: (runtime: typeof mocks.runtime, value: unknown) => runtime.writeJson(value),
}));

vi.mock("../config/config.js", async () => ({
  ...(await vi.importActual<typeof import("../config/config.js")>("../config/config.js")),
  readConfigFileSnapshot: async () => ({
    exists: true,
    valid: true,
    issues: [],
    warnings: [],
    legacyIssues: [],
    path: "/tmp/branch.json",
    raw: {},
    sourceConfig: {},
    resolved: {},
  }),
}));

const { runGrovesBuildCommand, runGrovesCreateCommand, runGrovesDevCommand, runGrovesValidateCommand } =
  await import("./groves-cli.project.js");
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("Grove project CLI", () => {
  beforeEach(() => {
    vi.stubEnv("BRANCH_EXPERIMENTAL_GROVES", "1");
    mocks.payloads.length = 0;
  });

  it("prints model, delegation targets, and notices in an offline package preview", async () => {
    mocks.runtime.log.mockClear();
    await runGrovesDevCommand("src/groves/fixtures/delegating-agent", {
      workspace: join(tempDirs.make("branch-grove-delegation-preview-"), "workspace"),
    });
    expect(mocks.runtime.log).toHaveBeenCalledWith(
      'Model: {"primary":"acme/primary","fallbacks":["acme/fallback"]}',
    );
    expect(mocks.runtime.log).toHaveBeenCalledWith("Delegation: researcher, writer; mode: prefer");
    expect(mocks.runtime.log).toHaveBeenCalledWith(
      expect.stringContaining('Notice: Model "acme/primary" is not in the local model catalog'),
    );
    expect(mocks.runtime.log).toHaveBeenCalledWith(
      expect.stringContaining(
        'Notice: Delegation target "researcher" is not in the local agent roster',
      ),
    );
    expect(mocks.runtime.log).toHaveBeenCalledWith("Blocked actions: 0");
  });

  it("runs create, validate, build, and offline dev against the built artifact", async () => {
    const root = join(tempDirs.make("branch-grove-author-"), "author-flow");
    const artifact = join(tempDirs.make("branch-grove-author-output-"), "author-flow.tgz");

    await runGrovesCreateCommand(root, { json: true });
    await runGrovesValidateCommand(root, { json: true });
    await runGrovesBuildCommand(root, { out: artifact, json: true });
    await runGrovesDevCommand(root, {
      agentId: "author-flow-preview",
      workspace: join(root, "preview-workspace"),
      json: true,
    });

    const payloads = mocks.payloads as Array<Record<string, unknown>>;
    expect(payloads.map((payload) => payload.schemaVersion)).toEqual([
      "branch.groveProject.v1",
      "branch.groveProject.v1",
      "branch.groveBuild.v1",
      "branch.clawDev.v1",
    ]);
    expect(payloads[1]).toMatchObject({ excludedPaths: [] });
    expect(payloads[2]).toMatchObject({ excludedPaths: [] });
    const dev = payloads[3] as { mutationAllowed: boolean; offline: boolean; plan: GrovePlan };
    expect(dev).toMatchObject({ mutationAllowed: false, offline: true });
    expect(dev.plan).toMatchObject({ mutationAllowed: false, blockers: [] });
    expect(dev.plan.grove).toMatchObject({
      integrityKind: "artifact",
      integrity: (payloads[2] as { integrity: string }).integrity,
    });
    expect(dev.plan.grove.packageRoot).toBe(
      `grove-artifact:${(payloads[2] as { integrity: string }).integrity}`,
    );
  });

  it("emits stable dev plans without deleted extraction paths", async () => {
    const root = join(tempDirs.make("branch-grove-dev-stable-"), "stable-dev");
    await runGrovesCreateCommand(root, { json: true });
    const options = {
      agentId: "stable-dev-preview",
      workspace: join(root, "preview-workspace"),
      json: true,
    };

    await runGrovesDevCommand(root, options);
    await runGrovesDevCommand(root, options);

    const payloads = mocks.payloads as Array<Record<string, unknown>>;
    const first = payloads[1] as { plan: GrovePlan };
    const second = payloads[2] as { plan: GrovePlan };
    expect(first.plan).toEqual(second.plan);
    expect(first.plan.planIntegrity).toBe(second.plan.planIntegrity);
    expect(JSON.stringify(first.plan)).not.toContain("branch-grove-artifact-");
    expect(first.plan.grove.packageRoot).toMatch(/^grove-artifact:sha256:/u);
  });

  it("uses command-specific schemas for build and dev failures", async () => {
    const missing = join(tempDirs.make("branch-grove-errors-"), "missing");

    await expect(
      runGrovesBuildCommand(missing, {
        out: join(tempDirs.make("branch-grove-error-output-"), "missing.tgz"),
        json: true,
      }),
    ).rejects.toThrow("__exit__:1");
    await expect(runGrovesDevCommand(missing, { json: true })).rejects.toThrow("__exit__:1");

    const payloads = mocks.payloads as Array<Record<string, unknown>>;
    expect(payloads).toMatchObject([
      { schemaVersion: "branch.groveBuild.v1", ok: false },
      { schemaVersion: "branch.clawDev.v1", ok: false },
    ]);
  });
});

type GrovePlan = {
  mutationAllowed: boolean;
  planIntegrity: string;
  blockers: unknown[];
  grove: { integrityKind: string; integrity: string; packageRoot: string };
};
