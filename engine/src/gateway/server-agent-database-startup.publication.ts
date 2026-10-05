import { AgentDatabasePreparationSupersededError } from "../state/agent-database-admission.js";

/**
 * Runs startup model publication under the preparation's currency check. A config or secrets
 * reload that supersedes the publication supersedes the whole preparation, so startup retries
 * it instead of leaving the agent degraded.
 */
export async function runStartupModelPublication(
  assertPreparationCurrent: () => void,
  publish: (isPublicationCurrent: () => boolean) => Promise<unknown>,
): Promise<void> {
  let superseded: unknown;
  try {
    await publish(() => {
      try {
        assertPreparationCurrent();
        return true;
      } catch (error) {
        superseded ??= error;
        return false;
      }
    });
  } catch (error) {
    if (superseded instanceof AgentDatabasePreparationSupersededError) {
      throw superseded;
    }
    throw error;
  }
}
