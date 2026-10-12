import { parseAgentSessionKey } from "../../routing/session-key.js";
import { getOpenIncognitoAgentDatabase } from "../../state/branch-agent-db-lifecycle.js";
import { isIncognitoBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { cloneEnvWithPlatformSemantics } from "../config-env-vars.js";
import type { SessionAccessScope } from "./session-accessor.sqlite-contract.js";
import { resolveSqliteSessionKey } from "./session-accessor.sqlite-scope-helpers.js";
import { withSessionStoreReaderInWorker } from "./session-entry-read-runtime.js";
import { resolveSessionStorePathForScope } from "./session-store-path.js";
import { listSessionSuggestionsInDatabase } from "./session-suggestion-store.kernel.js";

export async function listSessionSuggestions(
  input: SessionAccessScope,
  params: Parameters<typeof listSessionSuggestionsInDatabase>[2] = {},
) {
  const scope = { ...input, env: cloneEnvWithPlatformSemantics(input.env ?? process.env) };
  const storePath = resolveSessionStorePathForScope(scope);
  const filters = { ...params };
  const agentId =
    parseAgentSessionKey(scope.sessionKey)?.agentId ?? scope.agentId ?? scope.defaultAgentId;
  if (agentId && isIncognitoBranchAgentSqlitePath(storePath, { agentId, env: scope.env })) {
    // Process-held databases retain their native owner until the incognito actor cutover.
    const database = getOpenIncognitoAgentDatabase(agentId, storePath);
    return database
      ? listSessionSuggestionsInDatabase(
          database,
          resolveSqliteSessionKey(scope.sessionKey, agentId),
          filters,
        )
      : [];
  }
  return withSessionStoreReaderInWorker(
    { ...scope, storePath },
    ({ reader, logicalAgentId }) =>
      reader.readSuggestions({
        sessionKey: resolveSqliteSessionKey(scope.sessionKey, logicalAgentId),
        params: filters,
        env: scope.env,
      }),
    { dataOnly: true },
  );
}
