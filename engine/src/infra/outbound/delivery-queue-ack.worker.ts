import type { BranchStateDatabase } from "../../state/branch-state-db-contract.js";
import { runBranchStateWriteTransaction } from "../../state/branch-state-db.js";
import { ackDeliveryInDatabase } from "./delivery-queue-ack.kernel.js";
import { OUTBOUND_DELIVERY_QUEUE_NAME } from "./delivery-queue-namespaces.js";
import type { AckDeliveryOptions } from "./delivery-queue-settlement.types.js";

export function executeDeliveryQueueAck(
  input: { id: string; stateDir: string; options?: AckDeliveryOptions },
  writeOptions: { database: BranchStateDatabase; env: NodeJS.ProcessEnv },
): string[] {
  const { id, stateDir, options } = input;
  return runBranchStateWriteTransaction(
    (writer) => ackDeliveryInDatabase(writer, id, stateDir, options),
    writeOptions,
    { operationLabel: `mutate owned ${OUTBOUND_DELIVERY_QUEUE_NAME} delivery platform send` },
  );
}
