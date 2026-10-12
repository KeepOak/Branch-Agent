/** Detects whether a daemon was launched by Branch Agent's container-aware service wrapper. */
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";

/** Resolves the daemon container hint exposed by managed service environments. */
export function resolveDaemonContainerContext(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return (
    normalizeOptionalString(env.BRANCH_CONTAINER_HINT) ||
    normalizeOptionalString(env.BRANCH_CONTAINER) ||
    null
  );
}
