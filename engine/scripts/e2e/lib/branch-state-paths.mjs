import fs from "node:fs";
import path from "node:path";

export function assertRealPathInside(parentPath, childPath, label) {
  const parentRealPath = fs.realpathSync(parentPath);
  const childRealPath = fs.realpathSync(childPath);
  if (
    childRealPath !== parentRealPath &&
    !childRealPath.startsWith(`${parentRealPath}${path.sep}`)
  ) {
    throw new Error(`${label} resolved outside ${parentPath}: ${childRealPath}`);
  }
}

export function resolveHomePath(value) {
  if (value === "~") {
    return process.env.HOME;
  }
  if (value?.startsWith("~/") || value?.startsWith("~\\")) {
    return path.join(process.env.HOME, value.slice(2));
  }
  return value;
}

export function resolveBranchStateDir() {
  return process.env.BRANCH_STATE_DIR || path.join(process.env.HOME, ".branch");
}

export function resolveBranchConfigPath() {
  return process.env.BRANCH_CONFIG_PATH || path.join(resolveBranchStateDir(), "branch.json");
}
