import type { MessagePort } from "node:worker_threads";
import type { BranchAgentDatabaseValidation } from "../../state/branch-agent-db-validation-cache.js";
import {
  withBranchAgentDatabaseAdmission,
  type BranchAgentDatabase,
  type BranchAgentDatabaseOptions,
  type BranchAgentDatabaseWriteAdmission,
} from "../../state/branch-agent-db.js";
import { SqliteReclamationRequestRefusedError } from "./session-accessor.sqlite-reclamation-commit.js";

export function withWorkerWriteAdmission<T>(
  port: MessagePort,
  operationId: number,
  databaseOptions: BranchAgentDatabaseOptions,
  operation: (database: BranchAgentDatabase) => T | Promise<T>,
  assertSourceCurrent?: () => void,
): Promise<T> {
  let admissionId = 0;
  let finalAdmission = false;
  const withAdmission: BranchAgentDatabaseWriteAdmission = async (run) => {
    const requestedId = ++admissionId;
    const admission = await new Promise<{
      allowed: boolean;
      validation?: BranchAgentDatabaseValidation;
    }>((resolve, reject) => {
      const receive = (admissionMessage: {
        type: string;
        operationId: number;
        admissionId: number;
        allowed: boolean;
        validation?: BranchAgentDatabaseValidation;
      }) => {
        cleanup();
        if (
          admissionMessage.type !== "admission" ||
          admissionMessage.operationId !== operationId ||
          admissionMessage.admissionId !== requestedId
        ) {
          reject(new Error("SQLite reclamation Worker received invalid write admission"));
          return;
        }
        resolve(admissionMessage);
      };
      const closed = () => {
        cleanup();
        reject(new Error("SQLite reclamation parent closed during database admission"));
      };
      const cleanup = () => {
        port.off("message", receive);
        port.off("close", closed);
      };
      port.on("message", receive);
      port.once("close", closed);
      port.postMessage({
        type: "admission-request",
        operationId,
        admissionId: requestedId,
      });
    });
    const value = await run(() => {
      if (!admission.allowed) {
        throw new SqliteReclamationRequestRefusedError(
          "SQLite reclamation database admission was revoked",
        );
      }
      assertSourceCurrent?.();
    }, admission.validation);
    if (!finalAdmission) {
      port.postMessage({
        type: "admission-release",
        operationId,
        admissionId: requestedId,
      });
    }
    return value;
  };
  return withBranchAgentDatabaseAdmission(databaseOptions, withAdmission, (database) => {
    finalAdmission = true;
    return operation(database);
  });
}
