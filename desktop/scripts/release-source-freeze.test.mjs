import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { assertTrackedSourceClean } from "./release-source-freeze.mjs";
import { preparePnpm, repoRoot, run } from "../../scripts/feature-batch-ci-runtime.mjs";

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
const launcher = "#!/usr/bin/env node\nconsole.log('isolated bin fixture');\n";
async function fixture(mode, body) {
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir(), "release-source-fixture-"));
  try {
    await writeFile(join(root, "branch.mjs"), launcher);
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "release-bin-fixture", version: "1.0.0", bin: { branch: "branch.mjs" } }));
    await mkdir(join(root, "consumer"));
    await writeFile(join(root, "consumer/package.json"), JSON.stringify({ name: "bin-consumer", version: "1.0.0", dependencies: { "release-bin-fixture": "workspace:*" } }));
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - .\n  - consumer\n");
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    if (process.platform !== "win32") await chmod(join(root, "branch.mjs"), mode === "100755" ? 0o755 : 0o644);
    git(root, ["init", "-b", "main"]);
    git(root, ["add", "."]); git(root, ["update-index", mode === "100755" ? "--chmod=+x" : "--chmod=-x", "branch.mjs"]);
    git(root, ["-c", "user.name=Release fixture", "-c", "user.email=release@example.invalid", "commit", "-m", "fixture"]);
    await body(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("release entrypoint declares the executable Git mode expected by its package bin contract", () => {
  const record = git(repoRoot, ["ls-files", "--stage", "engine/branch.mjs"]);
  assert.match(record, /^100755 [a-f0-9]{40} 0\s+engine\/branch\.mjs$/, "Declared bin must be tracked executable before dependency installation");
});

test("complete source guard still rejects tracked content changes", () => fixture("100755", async root => {
  assertTrackedSourceClean(root);
  await writeFile(join(root, "branch.mjs"), launcher + "// mutation\n");
  assert.throws(() => assertTrackedSourceClean(root), /tracked modifications/);
}));

test("complete source guard still rejects tracked executable mode changes", { skip: process.platform === "win32" && "NTFS checkout does not expose POSIX executable mode changes" }, () => fixture("100755", async root => {
  assertTrackedSourceClean(root); await chmod(join(root, "branch.mjs"), 0o644);
  assert.throws(() => assertTrackedSourceClean(root), /tracked modifications/);
}));

test("fresh pinned pnpm frozen install preserves declared 0755 bin, with POSIX 0644 negative control", async () => {
  const base = process.env.RUNNER_TEMP ?? process.env.BRANCH_RELEASE_TEST_TEMP ?? tmpdir();
  const scratch = await mkdtemp(join(base, "release-pnpm-mode-proof-"));
  try {
    const pnpm = await preparePnpm(scratch);
    for (const mode of process.platform === "win32" ? ["100755"] : ["100644", "100755"]) await fixture(mode, async root => {
      await run(pnpm, ["install", "--lockfile-only", "--ignore-scripts"], root);
      if (process.platform !== "win32") await chmod(join(root, "branch.mjs"), mode === "100755" ? 0o755 : 0o644);
      git(root, ["add", "pnpm-lock.yaml"]);
      git(root, ["-c", "user.name=Release fixture", "-c", "user.email=release@example.invalid", "commit", "-m", "frozen fixture lock"]);
      assertTrackedSourceClean(root);
      const before = git(root, ["hash-object", "branch.mjs"]);
      await run(pnpm, ["install", "--frozen-lockfile", "--ignore-scripts"], root);
      assert.equal(git(root, ["hash-object", "branch.mjs"]), before, "The install must preserve launcher bytes");
      if (mode === "100644") assert.throws(() => assertTrackedSourceClean(root), /tracked modifications/);
      else assertTrackedSourceClean(root);
    });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
