export async function resolveConfiguredWorkspaces(
  config: unknown,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const { resolveMemoryRingsWorkspaces } =
    await import("branch/plugin-sdk/memory-core-host-status");
  return resolveMemoryRingsWorkspaces(
    config as Parameters<typeof resolveMemoryRingsWorkspaces>[0],
    { env },
  ).map((entry) => entry.workspaceDir);
}
