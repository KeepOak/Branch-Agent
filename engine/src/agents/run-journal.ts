import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { withPluginRuntimeGenerationScope } from "../plugins/runtime/generation-scope.js";
import { isIncognitoSessionKey } from "../shared/incognito-session-key.js";
import type { BranchAgentDatabaseOptions } from "../state/branch-agent-db-contract.js";
import type { DB } from "../state/branch-agent-db.generated.js";
import { runBranchAgentWriteTransaction } from "../state/branch-agent-db.js";
import { resolveIncognitoBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import {
  ensureRunJournalSchema,
  recordRunJournalSchemaCommitted,
} from "../state/branch-agent-run-journal-schema.js";
import type { RunEmbeddedAgentParams } from "./embedded-agent-runner/run/params.js";
import type { EmbeddedAgentRunResult } from "./embedded-agent-runner/types.js";
import type { PreparedModelRuntimeSnapshot } from "./prepared-model-runtime.types.js";
import type { AgentMessage } from "./runtime/index.js";
import type { AgentSessionEvent } from "./sessions/index.js";

type JournalDatabase = Pick<DB, "run_journal">;
type RunJournalStatus = "completed" | "failed";
export type RunJournalInput = {
  database: BranchAgentDatabaseOptions;
  runId: string;
  sessionId: string;
  snapshotId: string;
};
const scope = new AsyncLocalStorage<RunJournal>();

/** Captured by the subscriber; delivery may occur outside the original async scope. */
export function getRunJournal(): RunJournal | undefined {
  return scope.getStore();
}

/**
 * Managed Agents' ordered session log using the existing per-agent writer.
 * SQLite BEGIN IMMEDIATE admits each short write before any side effect runs.
 * No production reader/replay is introduced here (architecture Phase 1).
 */
export class RunJournal {
  private readonly tools = new Map<
    string,
    {
      operationKey: string;
      attemptId: string;
      call: Extract<AgentSessionEvent, { type: "tool_execution_start" }>;
    }
  >();
  private failure: { error: unknown } | undefined;

  constructor(private readonly input: RunJournalInput) {
    this.append("run_started", { snapshotId: input.snapshotId });
  }

  private append(
    eventType: string,
    payload: unknown,
    tool?: { operationKey: string; attemptId: string },
    compact = false,
  ): void {
    if (this.failure) {
      throw this.failure.error;
    }
    try {
      // Serialize before BEGIN; never hold the writer during model/tool work.
      const payloadJson = JSON.stringify(payload);
      let committedDatabase: Parameters<typeof recordRunJournalSchemaCommitted>[0] | undefined;
      runBranchAgentWriteTransaction(
        ({ db }) => {
          ensureRunJournalSchema(db);
          const query = getNodeSqliteKysely<JournalDatabase>(db);
          // Checkpoint insertion and covered-row reclamation share one transaction.
          if (compact) {
            executeSqliteQuerySync(
              db,
              query.deleteFrom("run_journal").where("session_id", "=", this.input.sessionId),
            );
          }
          executeSqliteQuerySync(
            db,
            query.insertInto("run_journal").values({
              run_id: this.input.runId,
              session_id: this.input.sessionId,
              snapshot_id: this.input.snapshotId,
              event_type: eventType,
              payload_json: payloadJson,
              operation_key: tool?.operationKey ?? null,
              attempt_id: tool?.attemptId ?? null,
              created_at: Date.now(),
            }),
          );
          committedDatabase = db;
        },
        this.input.database,
        { operationLabel: "agent.run-journal.append" },
      );
      if (committedDatabase) {
        recordRunJournalSchemaCommitted(committedDatabase);
      }
    } catch (error) {
      // Delivery observers can isolate errors; never later mark an unjournaled run successful.
      this.failure = { error: new Error("This run couldn't save its progress.", { cause: error }) };
      throw this.failure.error;
    }
  }

  record(event: AgentSessionEvent, messages: readonly AgentMessage[]): void {
    switch (event.type) {
      case "message_end":
        if (event.message.role === "assistant") {
          this.append("model_result", event.message);
        }
        break;
      case "tool_execution_start": {
        const tool = {
          operationKey: JSON.stringify([this.input.runId, event.toolCallId]),
          attemptId: randomUUID(),
          call: event,
        };
        this.append("tool_call", event, tool);
        this.tools.set(event.toolCallId, tool);
        break;
      }
      case "tool_execution_end": {
        const tool = this.tools.get(event.toolCallId);
        if (!tool) {
          const error = new Error("The tool finished without a saved start.");
          this.failure = { error };
          throw error;
        }
        this.append("tool_result", event, tool);
        this.tools.delete(event.toolCallId);
        break;
      }
      case "compaction_end":
        if (event.outcome.status === "completed") {
          this.append(
            "compaction_checkpoint",
            {
              messages,
              outcome: event.outcome,
              pendingTools: [...this.tools.entries()],
              snapshotId: this.input.snapshotId,
            },
            undefined,
            true,
          );
        } else {
          this.append("state_changed", event);
        }
        break;
      case "agent_start":
      case "agent_end":
      case "turn_start":
      case "turn_end":
        // Message and result payloads already have their own rows, not duplicate state copies.
        this.append("state_changed", { type: event.type });
        break;
      case "compaction_start":
      case "auto_retry_start":
      case "auto_retry_end":
      case "agent_settled":
      case "agent_handoff":
      case "queue_update":
      case "thinking_level_changed":
      case "session_info_changed":
        this.append("state_changed", event);
        break;
      default:
        // Token deltas and tool progress are not completed durable steps.
        break;
    }
  }

  end(status: RunJournalStatus): void {
    this.append("run_ended", { status });
  }
}

export async function withRunJournal<T>(
  input: RunJournalInput,
  run: () => Promise<T>,
  statusOf: (result: T) => RunJournalStatus = () => "completed",
): Promise<T> {
  const journal = new RunJournal(input);
  return scope.run(journal, async () => {
    let status: RunJournalStatus = "failed";
    try {
      const result = await run();
      status = statusOf(result);
      return result;
    } finally {
      journal.end(status);
    }
  });
}

export function withPreparedRunJournal<T extends EmbeddedAgentRunResult>(
  params: Pick<
    RunEmbeddedAgentParams,
    "agentId" | "runId" | "sessionId" | "sessionKey" | "sessionPersistence"
  >,
  snapshot: PreparedModelRuntimeSnapshot,
  run: () => Promise<T>,
): Promise<T> {
  const agentId = params.agentId;
  if (!agentId) {
    throw new Error("This run has no Trunk.");
  }
  return withPluginRuntimeGenerationScope(snapshot, () =>
    withRunJournal(
      {
        database: {
          agentId,
          path:
            isIncognitoSessionKey(params.sessionKey) || params.sessionPersistence === "detached"
              ? resolveIncognitoBranchAgentSqlitePath({ agentId })
              : path.join(snapshot.agentDir, "branch-agent.sqlite"),
        },
        runId: params.runId,
        sessionId: params.sessionId,
        snapshotId: snapshot.snapshotId,
      },
      run,
      (result) =>
        Boolean(result.meta.error) || result.meta.stopReason === "error" ? "failed" : "completed",
    ),
  );
}
