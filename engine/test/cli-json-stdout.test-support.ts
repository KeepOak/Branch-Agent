import { spawnSync } from "node:child_process";
import path from "node:path";

export function runBuiltCli(
  tempHome: string,
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  options: { inheritEnvironment?: boolean; execArgv?: string[] } = {},
) {
  const env: NodeJS.ProcessEnv = {
    ...(options.inheritEnvironment === false ? { PATH: process.env.PATH } : process.env),
    HOME: tempHome,
    USERPROFILE: tempHome,
    BRANCH_TEST_FAST: "1",
  };
  delete env.BRANCH_HOME;
  delete env.BRANCH_STATE_DIR;
  delete env.BRANCH_CONFIG_PATH;
  delete env.VITEST;
  Object.assign(env, envOverrides);

  const entry = path.resolve(process.cwd(), "branch.mjs");
  return spawnSync(process.execPath, [...(options.execArgv ?? []), entry, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000,
  });
}
