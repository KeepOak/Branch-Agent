// Gateway startup rewrites these process-wide values. Manual in-process test
// owners must snapshot them so later files never inherit a closed server or stale PATH.
export const GATEWAY_STARTUP_MUTATED_ENV_KEYS = [
  "PATH",
  "BRANCH_GATEWAY_PORT",
  "BRANCH_PATH_BOOTSTRAPPED",
] as const;

export const GATEWAY_TEST_ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  ...GATEWAY_STARTUP_MUTATED_ENV_KEYS,
  "BRANCH_STATE_DIR",
  "BRANCH_CONFIG_PATH",
  "BRANCH_AGENT_DIR",
  "BRANCH_GATEWAY_TOKEN",
  "BRANCH_SKIP_BROWSER_CONTROL_SERVER",
  "BRANCH_SKIP_GMAIL_WATCHER",
  "BRANCH_SKIP_CANVAS_HOST",
  "BRANCH_BUNDLED_PLUGINS_DIR",
  "BRANCH_DISABLE_BUNDLED_PLUGINS",
  "BRANCH_SKIP_CHANNELS",
  "BRANCH_SKIP_PROVIDERS",
  "BRANCH_SKIP_CRON",
  "BRANCH_TEST_MINIMAL_GATEWAY",
] as const;

/** Captures values that in-process Gateway startup can mutate. */
export function snapshotGatewayStartupEnv(): Record<string, string | undefined> {
  return Object.fromEntries(GATEWAY_STARTUP_MUTATED_ENV_KEYS.map((key) => [key, process.env[key]]));
}
