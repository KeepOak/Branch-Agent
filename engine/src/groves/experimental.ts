const EXPERIMENTAL_GROVES_ENV = "BRANCH_EXPERIMENTAL_GROVES";

export function isExperimentalGrovesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[EXPERIMENTAL_GROVES_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function assertExperimentalGrovesEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (isExperimentalGrovesEnabled(env)) {
    return;
  }
  throw new Error(
    `Groves are experimental and disabled. Set ${EXPERIMENTAL_GROVES_ENV}=1 for this process to enable the unstable CLI.`,
  );
}
