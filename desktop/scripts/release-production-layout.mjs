/** Use pnpm's existing Windows directory encoding on every production target; no package/file is omitted. */
export const PRODUCTION_VIRTUAL_STORE_NAME_LENGTH = 60;

export function productionDeployArguments(destination, verifiedExceptions) {
  return ["--filter", "branch", "deploy", "--prod", "--legacy", "--config.allow-unused-patches=true",
    ...verifiedExceptions, destination];
}

export function productionDeployEnvironment(environment) {
  return { ...environment, PNPM_CONFIG_VIRTUAL_STORE_DIR_MAX_LENGTH: String(PRODUCTION_VIRTUAL_STORE_NAME_LENGTH) };
}
