import { randomUUID } from "node:crypto";
import { runtimeProcessEntrypoints } from "../../infra/runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "../../infra/runtime-worker-url.js";
import type { AgentDatabaseExecutionScope } from "../../state/branch-agent-execution-contract.js";
import { executeBranchAgentWorkerPublication } from "../../state/branch-agent-worker-store.js";
import type { SessionForkOperations } from "./session-parent-fork.types.js";

export function executeSessionForkOperation<Key extends keyof SessionForkOperations>(
  worker: AgentDatabaseExecutionScope,
  databaseAgentId: string,
  command: { type: Key; input: SessionForkOperations[Key]["input"] },
): Promise<SessionForkOperations[Key]["output"]> {
  return executeBranchAgentWorkerPublication<SessionForkOperations, Key>(worker, {
    id: randomUUID(),
    moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sessionForkDomain).href,
    input: { agentId: databaseAgentId },
    command,
  });
}
