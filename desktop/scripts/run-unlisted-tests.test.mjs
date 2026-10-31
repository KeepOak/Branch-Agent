import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { namedInWorkflow, pickUnlistedTests } from "./run-unlisted-tests.mjs";

const WORKFLOW = [
  "jobs:",
  "  desktop:",
  "    defaults:",
  "      run:",
  "        working-directory: desktop",
  "    steps:",
  "      - name: Build",
  "        run: npm run build",
  "      - name: Listed from desktop",
  "        env:",
  "          BRANCH_DESKTOP_TEST_DIST: ${{ github.workspace }}/desktop/dist",
  "        run: node --test scripts/listed.test.mjs src/listed-src.test.ts",
  "      - name: Listed from the repo root",
  "        working-directory: ${{ github.workspace }}",
  "        run: node --test desktop/scripts/root-listed.test.mjs",
  "      - name: A root script that shares a desktop file name",
  "        working-directory: ${{ github.workspace }}",
  "        run: node --test scripts/same-name.test.mjs",
  "",
].join("\n");

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "branch-unlisted-tests-"));
  const desktopDir = join(root, "desktop");
  mkdirSync(join(desktopDir, "scripts"), { recursive: true });
  mkdirSync(join(desktopDir, "src"), { recursive: true });
  for (const file of files) writeFileSync(join(desktopDir, file), "");
  const workflowPath = join(root, "desktop-checks.yml");
  writeFileSync(workflowPath, WORKFLOW);
  return { root, desktopDir, workflowPath };
}

test("files a step names are skipped, from desktop/ and from the repo root", () => {
  const f = fixture(["scripts/listed.test.mjs", "src/listed-src.test.ts", "scripts/root-listed.test.mjs"]);
  try {
    assert.deepEqual(pickUnlistedTests({ ...f, excluded: [] }), []);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a new file no step names is picked up, in scripts/ and src/", () => {
  const f = fixture(["scripts/listed.test.mjs", "scripts/brand-new.test.mjs", "src/brand-new-src.test.ts", "scripts/helper.mjs"]);
  try {
    assert.deepEqual(pickUnlistedTests({ ...f, excluded: [] }), ["scripts/brand-new.test.mjs", "src/brand-new-src.test.ts"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("an excluded file is skipped", () => {
  const f = fixture(["scripts/brand-new.test.mjs", "scripts/broken.test.mjs"]);
  try {
    const excluded = [["scripts/broken.test.mjs", "needs a real engine"]];
    assert.deepEqual(pickUnlistedTests({ ...f, excluded }), ["scripts/brand-new.test.mjs"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("a repo-root step's scripts/ path does not hide a desktop file of the same name", () => {
  const named = namedInWorkflow(WORKFLOW);
  assert.ok(!named.has("scripts/same-name.test.mjs"));
  assert.ok(named.has("scripts/root-listed.test.mjs"));
  const f = fixture(["scripts/same-name.test.mjs"]);
  try {
    assert.deepEqual(pickUnlistedTests({ ...f, excluded: [] }), ["scripts/same-name.test.mjs"]);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
