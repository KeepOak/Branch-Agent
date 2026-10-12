import type { WorkerOperations } from "../state/worker-operation-registry.js";
import type { groveProvenanceOperations } from "./provenance-write.worker.js";

export type GroveProvenanceWriteOperations = WorkerOperations<typeof groveProvenanceOperations>;
