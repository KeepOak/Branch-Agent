import { readTranscriptStatsBatchReadOnlySync } from "branch/plugin-sdk/memory-core-host-engine-sessions";
import { serveWorkerTasks } from "branch/plugin-sdk/worker-task-server";
import type { MemoryIndexTask, MemoryIndexTaskResult } from "./manager-cpu-worker-runtime.js";
import { prepareMemoryIndexChunks } from "./manager-index-preparation.js";

serveWorkerTasks<MemoryIndexTaskResult>((input) => {
  // SAFETY: The paired runtime owns this private discriminated task protocol.
  const task = input as MemoryIndexTask;
  if (task.kind === "prepare") {
    return { kind: "prepared", value: prepareMemoryIndexChunks(task.input) };
  }
  if (task.kind === "transcript-stats") {
    return {
      kind: "transcript-stats",
      stats: readTranscriptStatsBatchReadOnlySync(
        task.scopes.map((scope) => Object.assign({}, scope, { env: task.env })),
      ),
    };
  }
  throw new Error("Invalid memory indexing task");
});
