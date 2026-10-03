// Desktop restart receipts are inert until explicitly confirmed by the authenticated owner.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { withFileLock } from "./file-lock.js";
import type {
  QueuedSessionDeliveryPayload,
  SessionDeliveryRequesterBinding,
  SessionDeliveryRoute,
} from "./session-delivery-queue.records.js";

export type DesktopContinuationReceipt = {
  id: string;
  sessionKey: string;
  expectedSessionId: string;
  targetBuild: string;
};
export type DesktopContinuationRecord = DesktopContinuationReceipt & {
  version: 1;
  phase: "prepared" | "accepted" | "cancelled";
  requester: string;
  binding: SessionDeliveryRequesterBinding;
  route: SessionDeliveryRoute;
  checkpoint: string;
  message: string;
  queueId?: string;
};
export type DesktopContinuationDependencies = {
  assertOwner: (requester: string) => void;
  currentBuild: () => string | null;
  bindingIsCurrent: (binding: SessionDeliveryRequesterBinding) => Promise<boolean>;
  enqueue: (payload: QueuedSessionDeliveryPayload) => Promise<string>;
};
const LOCK_OPTIONS = {
  retries: { retries: 20, factor: 1.2, minTimeout: 10, maxTimeout: 100 },
  stale: 60_000,
  staleRecovery: "remove-if-definitely-stale" as const,
};
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function validate(value: unknown): asserts value is DesktopContinuationRecord {
  if (!value || typeof value !== "object") throw new Error("Invalid desktop continuation record");
  const v = value as DesktopContinuationRecord;
  if (
    v.version !== 1 ||
    !["prepared", "accepted", "cancelled"].includes(v.phase) ||
    ![
      v.id,
      v.sessionKey,
      v.expectedSessionId,
      v.targetBuild,
      v.requester,
      v.checkpoint,
      v.message,
    ].every(nonempty) ||
    !v.binding ||
    ![v.binding.agentId, v.binding.storePath, v.binding.sessionId, v.binding.sessionKey].every(
      nonempty,
    ) ||
    v.binding.sessionKey !== v.sessionKey ||
    v.binding.sessionId !== v.expectedSessionId ||
    !(v.binding.lifecycleRevision === null || nonempty(v.binding.lifecycleRevision)) ||
    !v.route ||
    ![v.route.channel, v.route.to].every(nonempty) ||
    !["direct", "group", "channel"].includes(v.route.chatType) ||
    (v.phase === "accepted" && !nonempty(v.queueId))
  ) {
    throw new Error("Invalid desktop continuation record");
  }
}
function publicReceipt(v: DesktopContinuationReceipt): DesktopContinuationReceipt {
  return {
    id: v.id,
    sessionKey: v.sessionKey,
    expectedSessionId: v.expectedSessionId,
    targetBuild: v.targetBuild,
  };
}

/** No startup consumer: receipts never cause replay merely by existing on disk. */
export class DesktopRestartContinuationStore {
  constructor(
    private readonly directory: string,
    private readonly deps: DesktopContinuationDependencies,
  ) {}
  private filename(id: string): string {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid desktop continuation receipt ID");
    return path.join(this.directory, `${id}.json`);
  }
  private async save(file: string, record: DesktopContinuationRecord): Promise<void> {
    validate(record);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(record));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }
  async prepare(
    input: Omit<DesktopContinuationRecord, "id" | "version" | "phase" | "queueId">,
  ): Promise<DesktopContinuationReceipt> {
    this.deps.assertOwner(input.requester);
    if (!(await this.deps.bindingIsCurrent(input.binding))) throw new Error("session-changed");
    this.deps.assertOwner(input.requester);
    const record: DesktopContinuationRecord = {
      ...structuredClone(input),
      id: randomUUID(),
      version: 1,
      phase: "prepared",
    };
    validate(record);
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.save(this.filename(record.id), record);
    return publicReceipt(record);
  }
  private async locked<T>(
    receipt: DesktopContinuationReceipt,
    requester: string,
    run: (record: DesktopContinuationRecord, file: string) => Promise<T>,
  ): Promise<T> {
    this.deps.assertOwner(requester);
    const file = this.filename(receipt.id);
    return withFileLock(file, LOCK_OPTIONS, async () => {
      this.deps.assertOwner(requester);
      const record: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      validate(record);
      if (
        record.requester !== requester ||
        JSON.stringify(publicReceipt(record)) !== JSON.stringify(publicReceipt(receipt))
      ) {
        throw new Error("Desktop continuation requester or binding mismatch");
      }
      return run(record, file);
    });
  }
  async resume(
    receipt: DesktopContinuationReceipt,
    requester: string,
  ): Promise<"accepted" | "session-changed" | "cancelled"> {
    return this.locked(receipt, requester, async (record, file) => {
      // A persisted acknowledgment is permanent, even if the session was reset after acceptance.
      if (record.phase === "accepted") return "accepted";
      if (record.phase === "cancelled") return "cancelled";
      if (this.deps.currentBuild() !== record.targetBuild)
        throw new Error("Desktop continuation target build is not running");
      if (!(await this.deps.bindingIsCurrent(record.binding))) return "session-changed";
      this.deps.assertOwner(record.requester);
      const queueId = await this.deps.enqueue({
        kind: "agentTurn",
        sessionKey: record.sessionKey,
        message: `${record.checkpoint}\n\n${record.message}`,
        messageId: `desktop-restart:${record.id}`,
        expectedSessionId: record.expectedSessionId,
        requesterBinding: record.binding,
        route: record.route,
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: record.sessionKey,
          sourceTool: "desktop_restart_continuation",
        },
        sourceReplyDeliveryMode: "automatic",
        idempotencyKey: `desktop-restart:${record.id}`,
        completionRetention: "permanent",
      });
      // If this write fails, the same permanent queue ID makes lost-ack retry safe.
      await this.save(file, { ...record, phase: "accepted", queueId });
      return "accepted";
    });
  }
  async cancel(
    receipt: DesktopContinuationReceipt,
    requester: string,
  ): Promise<"cancelled" | "accepted"> {
    return this.locked(receipt, requester, async (record, file) => {
      if (record.phase === "accepted") return "accepted";
      this.deps.assertOwner(record.requester);
      await this.save(file, { ...record, phase: "cancelled" });
      return "cancelled";
    });
  }
}
