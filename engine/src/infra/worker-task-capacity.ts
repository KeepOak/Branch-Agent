import { availableParallelism } from "node:os";
import { createWorkerComputeCapacity, type WorkerComputeCapacity } from "@branch/worker-runtime";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export { DEFAULT_WORKER_PENDING_TASKS, DEFAULT_WORKER_PENDING_BYTES } from "@branch/worker-runtime";

/** All runtime chunks share the same host-owned computation budget. */
export function getWorkerComputeCapacity(): WorkerComputeCapacity {
  return resolveGlobalSingleton(Symbol.for("branch.workerComputeCapacity"), () =>
    createWorkerComputeCapacity(Math.max(1, availableParallelism() - 1)),
  );
}
