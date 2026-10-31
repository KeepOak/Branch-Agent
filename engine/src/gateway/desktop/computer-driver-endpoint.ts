/** The desktop's Mac driver lease. The launcher moves it out of process.env and keeps it on this symbol. */
const DRIVER_LEASE = Symbol.for("branch.macComputerEndpoint");
export const DRIVER_ENDPOINT_ENV = "BRANCH_CUA_DRIVER_ENDPOINT";
export const DRIVER_ENDPOINT_FILE_ENV = "BRANCH_CUA_DRIVER_ENDPOINT_FILE";

/** The lease this gateway holds, or undefined when the desktop gave it none. */
export function driverLease(): string | undefined {
  const value = (globalThis as Record<symbol, unknown>)[DRIVER_LEASE];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The environment for the computer host. The launcher strips the lease from process.env so helper children never
 * inherit it; the computer host is the one helper that needs it, so it gets the lease explicitly and nothing else does.
 */
export function computerHostEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const lease = driverLease();
  if (!lease || env[DRIVER_ENDPOINT_ENV] || env[DRIVER_ENDPOINT_FILE_ENV]) return env;
  return { ...env, [DRIVER_ENDPOINT_ENV]: lease };
}

/** Whether the computer host's environment names a driver address at all. Logs and reasons use this, never the value. */
export function hasDriverEndpoint(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env[DRIVER_ENDPOINT_ENV] || env[DRIVER_ENDPOINT_FILE_ENV]);
}
