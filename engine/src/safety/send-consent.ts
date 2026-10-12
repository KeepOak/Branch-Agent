// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/messaging/triage/send-consent.ts (atlas SAFETY-0166)
/** Message consent is bound to one actor, room, preview and later user turn. */
import { createHash, randomUUID } from "node:crypto";
import { stableStringify } from "@branch/normalization-core/stable-stringify";
import { createSqliteAuditRecordStore } from "../infra/sqlite-audit-record-store.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";

export function sendConsentDigest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** The outbound draft fields an approval is bound to. */
export interface SendConsentDraft {
  draftId: string;
  source: string;
  inReplyToId?: string;
  threadId?: string;
  worldId?: string;
  channelId?: string;
  to: unknown;
  subject?: string;
  body: string;
  metadata?: unknown;
}

export function draftConsentDigest(draft: SendConsentDraft): string {
  return sendConsentDigest({
    draftId: draft.draftId,
    source: draft.source,
    inReplyToId: draft.inReplyToId,
    threadId: draft.threadId,
    worldId: draft.worldId,
    channelId: draft.channelId,
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    metadata: draft.metadata,
  });
}

export class SendConsentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SendConsentError";
    this.code = code;
  }
}

/** Throws unless the digest of the draft about to be sent equals the approved digest. */
export function assertDraftConsentDigest(draft: SendConsentDraft, approvedDigest: string): void {
  if (draftConsentDigest(draft) !== approvedDigest) {
    throw new SendConsentError(
      "The draft changed after it was previewed; preview it again before sending",
      "MESSAGE_DRAFT_CONSENT_DIGEST_MISMATCH",
    );
  }
}

interface PendingSend {
  nonce: string;
  digest: string;
  messageId: string;
  messageTime: number;
  armedAt: number;
  consumedBy: string | null;
}

/** A user turn in one conversation: who spoke, where, when and what they said. */
export interface SendConsentTurn {
  id?: string;
  entityId?: string;
  roomId?: string;
  createdAt?: number;
  text: string;
}

/** Durable compare-and-set storage for pending consent, one record per actor and room. */
export interface SendConsentStore {
  get(key: string): PendingSend | null | Promise<PendingSend | null>;
  compareAndSet(
    key: string,
    expected: PendingSend | null,
    next: PendingSend,
  ): boolean | Promise<boolean>;
}

const SEND_CONSENT_SCOPE = "safety.send-consent";
const SEND_CONSENT_MAX_ENTRIES = 512;
const SEND_CONSENT_TTL_MS = 5 * 60_000;

/** Opens the consent store in the shared state database. */
export function createSendConsentStore(options: BranchStateDatabaseOptions = {}): SendConsentStore {
  const records = createSqliteAuditRecordStore<PendingSend>({
    ...options,
    scope: SEND_CONSENT_SCOPE,
    maxEntries: SEND_CONSENT_MAX_ENTRIES,
  });
  return {
    get: (key) => records.entries().find((entry) => entry.key === key)?.value ?? null,
    compareAndSet: (key, expected, next) => records.compareAndSet(key, expected, next),
  };
}

// A qualified answer is not blanket permission. Only an entire affirmative
// answer consumes consent; questions, edits and refusals require another preview.
const affirmative =
  /^(?:yes|yes please|yeah|yep|ok|okay|sure|confirm|confirmed|send|send it|send the draft|go ahead|do it|proceed|approve|approved|sí|si|oui|ja|はい|确认|確認|확인)[.!。！\s]*$/iu;

function pendingSend(value: unknown): value is PendingSend {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<PendingSend>;
  return (
    typeof record.nonce === "string" &&
    typeof record.digest === "string" &&
    typeof record.messageId === "string" &&
    typeof record.messageTime === "number" &&
    Number.isFinite(record.messageTime) &&
    typeof record.armedAt === "number" &&
    Number.isFinite(record.armedAt) &&
    (record.consumedBy === null || typeof record.consumedBy === "string")
  );
}

export interface SendConsentOptions {
  /**
   * Exact whole-turn replies that also confirm this send, e.g. the value a
   * one-tap choice chip posts. Compared case-insensitively after trimming.
   */
  readonly affirmations?: readonly string[];
}

function isAffirmative(text: string, options: SendConsentOptions): boolean {
  if (affirmative.test(text)) {
    return true;
  }
  const normalized = text.toLowerCase();
  return (options.affirmations ?? []).some((value) => value.trim().toLowerCase() === normalized);
}

type IdentifiedTurn = Required<Pick<SendConsentTurn, "id" | "entityId" | "roomId" | "createdAt">> &
  SendConsentTurn;

function assertIdentifiedTurn(agentId: string, message: SendConsentTurn): IdentifiedTurn {
  if (
    !message.id ||
    !message.entityId ||
    !message.roomId ||
    message.entityId === agentId ||
    typeof message.createdAt !== "number" ||
    !Number.isFinite(message.createdAt)
  ) {
    throw new SendConsentError(
      "Send confirmation requires an identified user turn",
      "MESSAGE_CONFIRMATION_TURN_REQUIRED",
    );
  }
  return message as IdentifiedTurn;
}

async function consumeIfAnswer(
  store: SendConsentStore,
  key: string,
  existing: PendingSend,
  message: IdentifiedTurn,
  options: SendConsentOptions,
): Promise<"pending" | "confirmed" | "cancelled"> {
  if (existing.messageId === message.id || message.createdAt <= existing.messageTime) {
    return "pending";
  }
  const consumed = await store.compareAndSet(key, existing, {
    ...existing,
    consumedBy: message.id,
  });
  if (!consumed) {
    return "cancelled";
  }
  return isAffirmative(message.text.trim(), options) ? "confirmed" : "cancelled";
}

/**
 * Arms consent for an exact preview digest on the first call; a later turn by the same
 * actor in the same room confirms it once, only with a whole affirmative answer.
 */
export async function requireSendConsent(
  store: SendConsentStore,
  agentId: string,
  turn: SendConsentTurn,
  digest: string,
  options: SendConsentOptions = {},
): Promise<"pending" | "confirmed" | "cancelled"> {
  const message = assertIdentifiedTurn(agentId, turn);
  const key = `message-consent:${message.entityId}:${message.roomId}`;
  const stored = await store.get(key);
  const existing = pendingSend(stored) ? stored : null;
  const now = Date.now();
  if (existing) {
    if (existing.consumedBy === message.id) {
      return "cancelled";
    }
    const fresh =
      existing.digest === digest &&
      existing.consumedBy === null &&
      now >= existing.armedAt &&
      now - existing.armedAt <= SEND_CONSENT_TTL_MS;
    if (fresh) {
      return consumeIfAnswer(store, key, existing, message, options);
    }
  }
  const armed = await store.compareAndSet(key, stored ?? null, {
    nonce: randomUUID(),
    digest,
    messageId: message.id,
    messageTime: message.createdAt,
    armedAt: now,
    consumedBy: null,
  } satisfies PendingSend);
  return armed ? "pending" : "cancelled";
}
