import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Keep the complete tracked-source guard: bin mode changes are source changes too. */
export function assertTrackedSourceClean(root) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  assert.equal(status, "", "Release source has tracked modifications");
}
