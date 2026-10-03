import path from "node:path";
import { resolveIdentityPathViaExistingAncestorSync } from "./boundary-path.js";
import { isPathInside } from "./path-guards.js";

/** Declare the private filesystem namespace shared by every rehearsal child. */
export function buildUpdateRehearsalPathEnv(root: string): NodeJS.ProcessEnv {
  return {
    HOME: root,
    USERPROFILE: root,
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"),
    BRANCH_HOME: root,
    BRANCH_STATE_DIR: root,
    BRANCH_CONFIG_PATH: path.join(root, "branch.json"),
    BRANCH_WORKSPACE_DIR: path.join(root, "workspace"),
    BRANCH_SKIP_CHANNELS: "1",
    BRANCH_SKIP_PROVIDERS: "1",
    BRANCH_SKIP_CRON: "1",
    BRANCH_SKIP_GMAIL_WATCHER: "1",
    BRANCH_SKIP_CANVAS_HOST: "1",
    BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
    BRANCH_SKIP_STARTUP_MODEL_PREWARM: "1",
    BRANCH_NO_AUTO_UPDATE: "1",
    NODE_DISABLE_COMPILE_CACHE: "1",
  };
}

/** Recognize the complete 9.3+ driver contract; update-in-progress alone is also used by live Doctor. */
export function resolveUpdateRehearsalRoot(env: NodeJS.ProcessEnv): string | undefined {
  const root = env.BRANCH_STATE_DIR;
  if (
    !root ||
    !path.isAbsolute(root) ||
    !["0", "1"].includes(env.BRANCH_UPDATE_IN_PROGRESS ?? "") ||
    Object.entries(buildUpdateRehearsalPathEnv(root)).some(([key, value]) => env[key] !== value) ||
    env.BRANCH_SERVICE_REPAIR_POLICY !== "external" ||
    env.BRANCH_UPDATE_PARENT_ALLOWS_GATEWAY_SERVICE_REPAIR !== "0" ||
    env.BRANCH_UPDATE_PARENT_ALLOWS_GATEWAY_ACTIVATION !== "0" ||
    Boolean(env.BRANCH_COMPATIBILITY_HOST_VERSION)
  ) {
    return undefined;
  }
  return path.resolve(root);
}

/** Uncopied absolute locators remain inventory; they cannot grant writes outside the private root. */
export function isUpdateRehearsalReadOnlyPath(filePath: string, env: NodeJS.ProcessEnv): boolean {
  const root = resolveUpdateRehearsalRoot(env);
  if (!root) {
    return false;
  }
  const resolved = path.resolve(filePath);
  return (
    !isPathInside(root, resolved) ||
    !isPathInside(
      resolveIdentityPathViaExistingAncestorSync(root),
      resolveIdentityPathViaExistingAncestorSync(resolved),
    )
  );
}
