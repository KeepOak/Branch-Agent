import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  engineRoot,
  repoRoot,
  gitHead,
  preparePnpm,
  verifiedExceptionFlags,
  scratchRoot,
  run,
  sha256,
} from "./feature-batch-ci-runtime.mjs";
import {
  priorityTests,
  priorityMemoryIntegration,
  priorityMemoryFilter,
  priorityStrictRoots,
} from "./priority-capabilities-ci-targets.mjs";

const mode = process.argv[2] ?? "all";
assert(
  ["all", "test", "validate"].includes(mode),
  "Use all, test (installed checkout), or validate",
);
for (const file of priorityStrictRoots) await fs.access(path.join(engineRoot, file));
if (mode === "validate") {
  console.log(
    `Validated ${priorityTests.length} full suites, one filtered memory integration suite, and ${priorityStrictRoots.length} strict roots.`,
  );
} else {
  const scratch = await scratchRoot();
  const receipt = {
    head: await gitHead(),
    mode,
    platform: process.platform,
    node: process.version,
    fullSuites: priorityTests,
    filteredSuite: { file: priorityMemoryIntegration, filter: priorityMemoryFilter },
    status: "started",
    coverage: "Named source regressions; not installed-app or complete atlas acceptance.",
  };
  const sourceFiles = [
    "engine/package.json",
    "engine/pnpm-lock.yaml",
    "engine/pnpm-workspace.yaml",
    "scripts/priority-capabilities-ci.mjs",
    "scripts/priority-capabilities-ci.config.mjs",
    "scripts/priority-capabilities-ci-targets.mjs",
    ...priorityStrictRoots.map((file) => `engine/${file}`),
  ];
  const hashes = async () =>
    Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async (file) => [
          file,
          sha256(await fs.readFile(path.join(repoRoot, file))),
        ]),
      ),
    );
  const before = await hashes();
  const env = {
    ...process.env,
    BRANCH_HOME: path.join(scratch, "home"),
    BRANCH_STATE_DIR: path.join(scratch, "state"),
    BRANCH_CONFIG_PATH: path.join(scratch, "config.json"),
    BRANCH_PROFILE: "",
    BRANCH_TEST_ARTIFACT_DIR: path.join(scratch, "fixtures"),
    BRANCH_TEST_FAST: "1",
  };
  console.log(`Priority capability receipts: ${scratch}`);
  try {
    if (mode === "all") {
      const pnpm = await preparePnpm(scratch);
      await run(
        pnpm,
        [
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
          ...(await verifiedExceptionFlags("engine")),
          `--store-dir=${path.join(scratch, "pnpm-store")}`,
        ],
        engineRoot,
        env,
      );
    }
    await run(process.execPath, ["scripts/generate-kysely-types.mts"], engineRoot, env);
    const strict = path.join(scratch, "priority-strict.json");
    await fs.writeFile(
      strict,
      JSON.stringify(
        {
          extends: path.join(engineRoot, "tsconfig.json"),
          compilerOptions: {
            declaration: false,
            noEmit: true,
            rootDir: engineRoot,
            typeRoots: [path.join(engineRoot, "node_modules/@types")],
          },
          files: priorityStrictRoots.map((file) => path.join(engineRoot, file)),
          include: [],
          exclude: [],
        },
        null,
        2,
      ),
    );
    await run(
      process.execPath,
      ["scripts/run-tsgo.mjs", "--project", strict, "--extendedDiagnostics"],
      engineRoot,
      env,
    );
    const config = path.join(repoRoot, "scripts/priority-capabilities-ci.config.mjs");
    await run(
      process.execPath,
      [
        path.join(engineRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
        ...priorityTests,
      ],
      engineRoot,
      env,
    );
    await run(
      process.execPath,
      [
        path.join(engineRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
        priorityMemoryIntegration,
        "-t",
        priorityMemoryFilter,
      ],
      engineRoot,
      env,
    );
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = String(error);
    throw error;
  } finally {
    receipt.sourceHashes = await hashes();
    receipt.sourceUnchanged = JSON.stringify(before) === JSON.stringify(receipt.sourceHashes);
    if (!receipt.sourceUnchanged) receipt.status = "failed";
    await fs.writeFile(
      path.join(scratch, "priority-capabilities-proof.json"),
      JSON.stringify(receipt, null, 2) + "\n",
    );
    assert(receipt.sourceUnchanged, "Verification changed source or dependency-policy bytes");
  }
}
