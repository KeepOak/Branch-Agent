import { assignExistingTrunkCharacters } from "../agents/trunk-characters.js";
import { readConfigFileSnapshotForWrite, transformConfigFileWithRetry } from "../config/config.js";
import { resolveIsConfigReadOnly } from "../config/paths.js";

/** A config-local marker makes the one-time assignment atomic with the avatars. */
export async function assignTrunkCharactersAtStartup(): Promise<void> {
  if (resolveIsConfigReadOnly()) return;
  const snapshot = await readConfigFileSnapshotForWrite();
  if (!snapshot.snapshot.exists || !Object.keys(snapshot.snapshot.config.agents?.entries ?? {}).length || snapshot.snapshot.config.agents?.characterAssignmentVersion === 1) return;
  await transformConfigFileWithRetry({
    transform: (config) => ({ nextConfig: assignExistingTrunkCharacters(config) }),
  });
}
