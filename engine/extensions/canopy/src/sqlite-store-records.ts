import type { DatabaseSync } from "node:sqlite";
import type {
  CanopyAttachment,
  CanopyCard,
  CanopyDiagnostic,
  CanopyEvent,
  CanopyExecution,
  CanopyLink,
  CanopyMetadata,
  CanopyNotification,
  CanopyProof,
  CanopyRunAttempt,
  CanopyWorkerLog,
} from "@branch/canopy-contract";
import {
  getNodeSqliteKysely,
  iterateSqliteQuerySync,
  sqliteStringSet,
} from "branch/plugin-sdk/sqlite-worker-runtime";
export type Row = Record<string, unknown>;

export function jsonValue(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  return JSON.parse(value);
}

export function stringValue(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(row: Row, key: string): number | undefined {
  const value = row[key];
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return undefined;
}

export function requiredString(row: Row, key: string): string {
  const value = stringValue(row, key);
  if (!value) {
    throw new Error(`canopy sqlite row missing ${key}`);
  }
  return value;
}

export function requiredNumber(row: Row, key: string): number {
  const value = numberValue(row, key);
  if (value === undefined) {
    throw new Error(`canopy sqlite row missing ${key}`);
  }
  return value;
}

function optional<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

export function definedFields<T extends object>(fields: T): T {
  for (const key in fields) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }
  return fields;
}

export function blobToBase64(value: unknown): string {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (typeof value === "string") {
    return Buffer.from(value).toString("base64");
  }
  return "";
}

// Every child table a card row expands into. Reading one card issues one query per
// entry here; reading the whole board that way is a query per card per table, which
// is why the batch read path preloads them instead.
export const CARD_CHILD_TABLES = [
  "canopy_card_labels",
  "canopy_card_events",
  "canopy_card_attempts",
  "canopy_card_comments",
  "canopy_card_links",
  "canopy_card_proof",
  "canopy_card_artifacts",
  "canopy_card_attachments",
  "canopy_worker_logs",
  "canopy_card_diagnostics",
  "canopy_card_notifications",
] as const;

export type CanopyCardDatabase = Record<
  (typeof CARD_CHILD_TABLES)[number] | "canopy_cards" | "canopy_worker_protocol",
  Row
>;

/**
 * Child rows for a whole batch of cards, grouped by card id.
 *
 * Present only on the batch read path. `lookup` passes none and keeps issuing the
 * per-card queries, which is already the cheapest shape for a single card.
 */
type CardChildRows = {
  byTable: Map<string, Map<string, Row[]>>;
  workerProtocol: Map<string, Row>;
};

function groupByCardId(rows: Iterable<Row>): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const cardId = stringValue(row, "card_id");
    if (!cardId) {
      continue;
    }
    const bucket = grouped.get(cardId);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(cardId, [row]);
    }
  }
  return grouped;
}

export function loadCardChildRows(db: DatabaseSync, cardIds?: string[]): CardChildRows {
  // Group raw rows only: every preload must finish before card decoding can fail.
  const query = getNodeSqliteKysely<CanopyCardDatabase>(db);
  // Scope to captured IDs so a concurrent board move cannot discard a selected card's children.
  const selectedIds = cardIds ? sqliteStringSet(cardIds) : undefined;
  const byTable = new Map<string, Map<string, Row[]>>();
  for (const table of CARD_CHILD_TABLES) {
    // Same order the per-card query produces, so grouped buckets stay ordinal-sorted.
    let rows = query
      .selectFrom(table)
      .selectAll()
      .orderBy("card_id", "asc")
      .orderBy("ordinal", "asc");
    if (selectedIds) {
      rows = rows.where("card_id", "in", selectedIds);
    }
    byTable.set(table, groupByCardId(iterateSqliteQuerySync(db, rows)));
  }
  const workerProtocol = new Map<string, Row>();
  let protocols = query.selectFrom("canopy_worker_protocol").selectAll();
  if (selectedIds) {
    protocols = protocols.where("card_id", "in", selectedIds);
  }
  for (const row of iterateSqliteQuerySync(db, protocols)) {
    const cardId = stringValue(row, "card_id");
    if (cardId) {
      workerProtocol.set(cardId, row);
    }
  }
  return { byTable, workerProtocol };
}

function childRows(
  db: DatabaseSync,
  table: string,
  cardId: string,
  preloaded?: CardChildRows,
): Row[] {
  const cached = preloaded?.byTable.get(table);
  if (cached) {
    const rows = cached.get(cardId) ?? [];
    // Each table is read once per card. Release the raw rows as the decoded card
    // is built instead of retaining both complete representations of the board.
    cached.delete(cardId);
    return rows;
  }
  // Finish native extraction before decoding; a later row can contain the first error.
  return db.prepare(`SELECT * FROM ${table} WHERE card_id = ? ORDER BY ordinal ASC`).all(cardId);
}

function workerProtocolRow(
  db: DatabaseSync,
  cardId: string,
  preloaded?: CardChildRows,
): Row | undefined {
  if (preloaded) {
    const row = preloaded.workerProtocol.get(cardId);
    preloaded.workerProtocol.delete(cardId);
    return row;
  }
  return db.prepare("SELECT * FROM canopy_worker_protocol WHERE card_id = ?").get(cardId);
}

function readLabels(db: DatabaseSync, cardId: string, preloaded?: CardChildRows): string[] {
  return childRows(db, "canopy_card_labels", cardId, preloaded).flatMap((row) => {
    const label = stringValue(row, "label");
    return label ? [label] : [];
  });
}

function readEvents(
  db: DatabaseSync,
  cardId: string,
  preloaded?: CardChildRows,
): CanopyEvent[] | undefined {
  const events = childRows(db, "canopy_card_events", cardId, preloaded).map((row) => {
    return definedFields({
      id: requiredString(row, "id"),
      // SAFETY: insertChildren persists the event kind from CanopyEvent.
      kind: requiredString(row, "kind") as CanopyEvent["kind"],
      at: requiredNumber(row, "at"),
      // SAFETY: Event status transitions are persisted from CanopyEvent without translation.
      fromStatus: stringValue(row, "from_status") as CanopyEvent["fromStatus"],
      // SAFETY: Event status transitions are persisted from CanopyEvent without translation.
      toStatus: stringValue(row, "to_status") as CanopyEvent["toStatus"],
      sessionKey: stringValue(row, "session_key"),
      runId: stringValue(row, "run_id"),
    });
  });
  return events.length > 0 ? events : undefined;
}

function readExecution(row: Row): CanopyExecution | undefined {
  const id = stringValue(row, "execution_id");
  if (!id) {
    return undefined;
  }
  return definedFields<CanopyExecution>({
    id,
    kind: "agent-session",
    // SAFETY: insertCard persists the execution mode from CanopyExecution.
    mode: requiredString(row, "execution_mode") as CanopyExecution["mode"],
    // SAFETY: insertCard persists the execution status from CanopyExecution.
    status: requiredString(row, "execution_status") as CanopyExecution["status"],
    engine: stringValue(row, "execution_engine"),
    model: stringValue(row, "execution_model"),
    sessionKey: stringValue(row, "execution_session_key"),
    runId: stringValue(row, "execution_run_id"),
    startedAt: requiredNumber(row, "execution_started_at"),
    updatedAt: requiredNumber(row, "execution_updated_at"),
  });
}

export function readAttachment(row: Row): CanopyAttachment {
  return definedFields({
    id: requiredString(row, "id"),
    cardId: requiredString(row, "card_id"),
    createdAt: requiredNumber(row, "created_at"),
    fileName: requiredString(row, "file_name"),
    byteSize: requiredNumber(row, "byte_size"),
    mimeType: stringValue(row, "mime_type"),
    note: stringValue(row, "note"),
  });
}

function readMetadata(
  db: DatabaseSync,
  row: Row,
  preloaded?: CardChildRows,
): CanopyMetadata | undefined {
  const cardId = requiredString(row, "id");
  const attempts = childRows(db, "canopy_card_attempts", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      // SAFETY: Attempt rows preserve CanopyRunAttempt.status.
      status: requiredString(child, "status") as CanopyRunAttempt["status"],
      startedAt: requiredNumber(child, "started_at"),
      endedAt: numberValue(child, "ended_at"),
      engine: stringValue(child, "engine"),
      // SAFETY: Attempt rows preserve CanopyRunAttempt.mode.
      mode: stringValue(child, "mode") as CanopyRunAttempt["mode"],
      model: stringValue(child, "model"),
      sessionKey: stringValue(child, "session_key"),
      runId: stringValue(child, "run_id"),
      error: stringValue(child, "error"),
    });
  });
  const comments = childRows(db, "canopy_card_comments", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      body: requiredString(child, "body"),
      createdAt: requiredNumber(child, "created_at"),
      updatedAt: numberValue(child, "updated_at"),
    });
  });
  const links = childRows(db, "canopy_card_links", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      // SAFETY: Link rows preserve CanopyLink.type.
      type: requiredString(child, "type") as CanopyLink["type"],
      createdAt: requiredNumber(child, "created_at"),
      targetCardId: stringValue(child, "target_card_id"),
      title: stringValue(child, "title"),
      url: stringValue(child, "url"),
    });
  });
  const proof = childRows(db, "canopy_card_proof", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      // SAFETY: Proof rows preserve CanopyProof.status.
      status: requiredString(child, "status") as CanopyProof["status"],
      createdAt: requiredNumber(child, "created_at"),
      label: stringValue(child, "label"),
      command: stringValue(child, "command"),
      url: stringValue(child, "url"),
      note: stringValue(child, "note"),
    });
  });
  const artifacts = childRows(db, "canopy_card_artifacts", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      createdAt: requiredNumber(child, "created_at"),
      label: stringValue(child, "label"),
      url: stringValue(child, "url"),
      path: stringValue(child, "path"),
      mimeType: stringValue(child, "mime_type"),
    });
  });
  const attachments = childRows(db, "canopy_card_attachments", cardId, preloaded).map(
    readAttachment,
  );
  const workerLogs = childRows(db, "canopy_worker_logs", cardId, preloaded).map((child) => {
    return definedFields({
      id: requiredString(child, "id"),
      createdAt: requiredNumber(child, "created_at"),
      // SAFETY: Worker log rows preserve CanopyWorkerLog.level.
      level: requiredString(child, "level") as CanopyWorkerLog["level"],
      message: requiredString(child, "message"),
      sessionKey: stringValue(child, "session_key"),
      runId: stringValue(child, "run_id"),
    });
  });
  const diagnostics = childRows(db, "canopy_card_diagnostics", cardId, preloaded).map(
    (child) => ({
      // SAFETY: Diagnostic rows preserve CanopyDiagnostic.kind.
      kind: requiredString(child, "kind") as CanopyDiagnostic["kind"],
      // SAFETY: Diagnostic rows preserve CanopyDiagnostic.severity.
      severity: requiredString(child, "severity") as CanopyDiagnostic["severity"],
      title: requiredString(child, "title"),
      detail: requiredString(child, "detail"),
      firstSeenAt: requiredNumber(child, "first_seen_at"),
      lastSeenAt: requiredNumber(child, "last_seen_at"),
      count: requiredNumber(child, "count"),
      // SAFETY: insertChildren serializes the diagnostic actions unchanged.
      actions: (parseJson(child.actions_json) as CanopyDiagnostic["actions"] | undefined) ?? [],
    }),
  );
  const notifications = childRows(db, "canopy_card_notifications", cardId, preloaded).map(
    (child) => {
      return definedFields({
        id: requiredString(child, "id"),
        // SAFETY: Notification rows preserve CanopyNotification.kind.
        kind: requiredString(child, "kind") as CanopyNotification["kind"],
        createdAt: requiredNumber(child, "created_at"),
        message: requiredString(child, "message"),
        sequence: numberValue(child, "sequence"),
        sessionKey: stringValue(child, "session_key"),
        runId: stringValue(child, "run_id"),
      });
    },
  );
  const protocol = workerProtocolRow(db, cardId, preloaded);
  // SAFETY: insertCard serializes CanopyMetadata.automation unchanged.
  const automation = parseJson(row.automation_json) as CanopyMetadata["automation"] | undefined;
  // SAFETY: insertCard serializes CanopyMetadata.claim unchanged.
  const claim = parseJson(row.claim_json) as CanopyMetadata["claim"] | undefined;
  // SAFETY: insertCard serializes CanopyMetadata.stale unchanged.
  const stale = parseJson(row.stale_json) as CanopyMetadata["stale"] | undefined;
  return optional(
    definedFields({
      attempts: attempts.length > 0 ? attempts : undefined,
      comments: comments.length > 0 ? comments : undefined,
      links: links.length > 0 ? links : undefined,
      proof: proof.length > 0 ? proof : undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      workerLogs: workerLogs.length > 0 ? workerLogs : undefined,
      workerProtocol: protocol
        ? definedFields({
            // SAFETY: Protocol rows preserve CanopyMetadata.workerProtocol.state.
            state: requiredString(protocol, "state") as NonNullable<
              CanopyMetadata["workerProtocol"]
            >["state"],
            updatedAt: requiredNumber(protocol, "updated_at"),
            detail: stringValue(protocol, "detail"),
          })
        : undefined,
      automation: automation || undefined,
      claim: claim || undefined,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      notifications: notifications.length > 0 ? notifications : undefined,
      // SAFETY: insertCard persists the CanopyMetadata template identifier.
      templateId: stringValue(row, "template_id") as CanopyMetadata["templateId"],
      archivedAt: numberValue(row, "archived_at"),
      stale: stale || undefined,
      lifecycleStatusSourceUpdatedAt: numberValue(row, "lifecycle_status_source_updated_at"),
      failureCount: numberValue(row, "failure_count"),
    }),
  );
}

export function readCard(db: DatabaseSync, row: Row, preloaded?: CardChildRows): CanopyCard {
  const card: CanopyCard = {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    // SAFETY: insertCard persists the CanopyCard status unchanged.
    status: requiredString(row, "status") as CanopyCard["status"],
    // SAFETY: insertCard persists the CanopyCard priority unchanged.
    priority: requiredString(row, "priority") as CanopyCard["priority"],
    labels: readLabels(db, requiredString(row, "id"), preloaded),
    position: requiredNumber(row, "position"),
    createdAt: requiredNumber(row, "created_at"),
    updatedAt: requiredNumber(row, "updated_at"),
  };
  const metadata = readMetadata(db, row, preloaded);
  const events = readEvents(db, card.id, preloaded);
  const execution = readExecution(row);
  return definedFields({
    ...card,
    notes: stringValue(row, "notes"),
    agentId: stringValue(row, "agent_id"),
    sessionKey: stringValue(row, "session_key"),
    runId: stringValue(row, "run_id"),
    sourceUrl: stringValue(row, "source_url"),
    execution,
    startedAt: numberValue(row, "started_at"),
    completedAt: numberValue(row, "completed_at"),
    events,
    metadata,
  });
}
