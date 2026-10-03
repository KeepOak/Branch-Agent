import path from "node:path";
import { setTestEnvValue } from "../test-utils/env.js";
import { GATEWAY_STARTUP_MUTATED_ENV_KEYS } from "./test-helpers.env.js";

const MANUAL_GATEWAY_BACKGROUND_ENV_KEYS = [
  "BRANCH_SKIP_BROWSER_CONTROL_SERVER",
  "BRANCH_SKIP_GMAIL_WATCHER",
  "BRANCH_SKIP_CANVAS_HOST",
  "BRANCH_SKIP_CHANNELS",
  "BRANCH_SKIP_PROVIDERS",
  "BRANCH_SKIP_CRON",
  "BRANCH_DISABLE_BUNDLED_PLUGINS",
  "BRANCH_BUNDLED_PLUGINS_DIR",
] as const;

export const MANUAL_GATEWAY_ENV_KEYS = [
  ...GATEWAY_STARTUP_MUTATED_ENV_KEYS,
  ...MANUAL_GATEWAY_BACKGROUND_ENV_KEYS,
] as const;

/** Keeps manual RPC suites on the real core Gateway without unrelated startup work. */
export function configureManualGatewayBackgroundEnv(tempHome: string): void {
  setTestEnvValue("BRANCH_SKIP_BROWSER_CONTROL_SERVER", "1");
  setTestEnvValue("BRANCH_SKIP_GMAIL_WATCHER", "1");
  setTestEnvValue("BRANCH_SKIP_CANVAS_HOST", "1");
  setTestEnvValue("BRANCH_SKIP_CHANNELS", "1");
  setTestEnvValue("BRANCH_SKIP_PROVIDERS", "1");
  setTestEnvValue("BRANCH_SKIP_CRON", "1");
  setTestEnvValue("BRANCH_DISABLE_BUNDLED_PLUGINS", "1");
  setTestEnvValue("BRANCH_BUNDLED_PLUGINS_DIR", path.join(tempHome, "no-plugins"));
}
