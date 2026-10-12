import { createHash } from "node:crypto";
import fs from "node:fs";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  listAgentIds,
  tryResolveContactDefaultAgentId,
  tryResolveDefaultAgentId,
} from "../../agents/agent-scope-config.js";
import { listExistingAgentDatabaseTargets } from "../../infra/session-sqlite-migration-readers.js";
import {
  createSqliteAuditRecordKernel,
  prepareSqliteAuditRecord,
} from "../../infra/sqlite-audit-record.kernel.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import {
  SYSTEM_AGENT_AUDIT_MAX_ENTRIES,
  SYSTEM_AGENT_AUDIT_SCOPE,
} from "../../system-agent/audit.js";
import type { BranchConfig } from "../types.branch.js";
import { resolveCanonicalMainSessionKey } from "./main-session-key.js";
import { resolveSessionStorePathCore } from "./paths.js";
import { parseSqliteSessionEntryRecord } from "./session-entry-json.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";
import type { SessionEntry } from "./types.js";

type Row = Record<string, SQLInputValue>;
type Store = { agentId: string; path: string; alias: string };
type Move = { source: Store; key: string; targetKey: string; entry: SessionEntry };
const SESSION_KEY_TABLES = [
  "board_tabs",
  "board_widgets",
  "heartbeat_outcomes",
  "session_members",
  "session_participants",
  "session_progress_cards",
  "session_suggestions",
  "session_reactions",
  "session_entry_snapshots",
  "session_goal_operations",
  "session_input_completions",
  "session_pending_inputs",
  "session_transcript_archives",
] as const;
const SESSION_ID_TABLES = [
  "transcript_events",
  "transcript_event_identities",
  "transcript_rewrite_watermarks",
  "trajectory_runtime_events",
  "acp_parent_stream_events",
  "session_transcript_active_events",
  "session_transcript_index_state",
  "session_transcript_cold_archives",
  "context_engine_turn_outbox",
  "session_conversations",
] as const;

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableExists(db: DatabaseSync, alias: string, table: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM ${quote(alias)}.sqlite_master WHERE type='table' AND name=?`)
      .get(table),
  );
}

function rows(
  db: DatabaseSync,
  alias: string,
  table: string,
  column: string,
  value: SQLInputValue,
): Row[] {
  if (!tableExists(db, alias, table)) return [];
  return db
    .prepare(`SELECT * FROM ${quote(alias)}.${quote(table)} WHERE ${quote(column)}=?`)
    .all(value) as Row[];
}

function insert(
  db: DatabaseSync,
  alias: string,
  table: string,
  row: Row,
  omit: readonly string[] = [],
): void {
  const columns = Object.keys(row).filter((column) => !omit.includes(column));
  db.prepare(
    `INSERT INTO ${quote(alias)}.${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(...columns.map((column) => row[column]!));
}

function updateNode(db: DatabaseSync, store: Store, key: string, entry: SessionEntry): void {
  db.prepare(
    `UPDATE ${quote(store.alias)}.session_nodes SET entry_json=?, archived_at=? WHERE session_key=?`,
  ).run(JSON.stringify(entry), entry.archivedAt ?? null, key);
}

function sourceRows(db: DatabaseSync, store: Store): Array<{ key: string; entry: SessionEntry }> {
  return (
    db
      .prepare(
        `SELECT session_key, current_session_id, updated_at, entry_json FROM ${quote(store.alias)}.session_nodes`,
      )
      .all() as Array<{
      session_key: string;
      current_session_id: string;
      updated_at: number;
      entry_json: string;
    }>
  ).flatMap((row) => {
    // Canonical row repair owns malformed metadata. Do not let an unrelated
    // contact migration prevent Doctor from reaching that repair owner.
    const entry = parseSqliteSessionEntryRecord(row);
    return entry ? [{ key: row.session_key, entry }] : [];
  });
}

function hasMessages(db: DatabaseSync, store: Store, key: string, entry: SessionEntry): boolean {
  const ids = new Set([
    entry.sessionId,
    ...rows(db, store.alias, "session_windows", "session_key", key).map(
      (row) => row.session_id as string,
    ),
  ]);
  for (const id of ids) {
    if (!id) continue;
    const events = rows(db, store.alias, "transcript_events", "session_id", id);
    // An encoded event is not evidence of emptiness. Only archive when every
    // recorded event can be inspected and none is a message.
    for (const event of events) {
      if (typeof event.event_json !== "string") return true;
      try {
        const parsed = JSON.parse(event.event_json) as { type?: string; role?: string };
        if (parsed.type === "message" || parsed.role === "user" || parsed.role === "assistant")
          return true;
      } catch {
        return true;
      }
    }
    if (rows(db, store.alias, "session_transcript_cold_archives", "session_id", id).length)
      return true;
  }
  return false;
}

function copyConversation(db: DatabaseSync, from: Store, to: Store, id: string): void {
  if (db.prepare(`SELECT 1 FROM ${quote(to.alias)}.conversations WHERE conversation_id=?`).get(id))
    return;
  for (const row of rows(db, from.alias, "conversations", "conversation_id", id))
    insert(db, to.alias, "conversations", row);
}

function copyMove(
  db: DatabaseSync,
  move: Move,
  destination: Store,
  remap: ReadonlyMap<string, string>,
  threadKey: string,
): void {
  const { source, key, targetKey, entry } = move;
  const existing = rows(db, destination.alias, "session_nodes", "session_key", targetKey);
  if (existing.length) throw new Error(`Contact migration target already exists: ${targetKey}`);
  const sourceNode = rows(db, source.alias, "session_nodes", "session_key", key)[0];
  if (!sourceNode) throw new Error(`Contact migration source disappeared: ${key}`);
  const windows = rows(db, source.alias, "session_windows", "session_key", key);
  const ids = new Set([entry.sessionId, ...windows.map((window) => window.session_id as string)]);
  const idMap = new Map(
    [...ids].filter(Boolean).map((id) => {
      const hash = createHash("sha256").update(`${source.path}\0${key}\0${id}`).digest("hex");
      return [
        id,
        `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
      ] as const;
    }),
  );
  for (const id of idMap.values()) {
    if (rows(db, destination.alias, "session_windows", "session_id", id).length) {
      throw new Error(`Contact migration session id collision: ${id}`);
    }
  }
  const relocated: SessionEntry = {
    ...entry,
    sessionId: idMap.get(entry.sessionId) ?? entry.sessionId,
    ...(entry.previousSessionId
      ? { previousSessionId: idMap.get(entry.previousSessionId) ?? entry.previousSessionId }
      : {}),
    ...(entry.parentSessionKey
      ? { parentSessionKey: remap.get(entry.parentSessionKey) ?? threadKey }
      : {}),
    ...(entry.contactAnchor ? { contactAnchor: { ...entry.contactAnchor, threadKey } } : {}),
  };
  insert(
    db,
    destination.alias,
    "session_nodes",
    {
      ...sourceNode,
      session_key: targetKey,
      entry_json: JSON.stringify(relocated),
      current_session_id: relocated.sessionId,
      parent_session_key: relocated.parentSessionKey ?? null,
      fork_source_session_key:
        typeof sourceNode.fork_source_session_key === "string"
          ? (remap.get(sourceNode.fork_source_session_key) ?? sourceNode.fork_source_session_key)
          : null,
    },
    ["snapshot_revision"],
  );
  for (const window of windows) {
    if (typeof window.primary_conversation_id === "string")
      copyConversation(db, source, destination, window.primary_conversation_id);
    insert(db, destination.alias, "session_windows", {
      ...window,
      session_id: idMap.get(window.session_id as string)!,
      previous_session_id:
        typeof window.previous_session_id === "string"
          ? (idMap.get(window.previous_session_id) ?? window.previous_session_id)
          : null,
      session_key: targetKey,
      parent_session_key:
        typeof window.parent_session_key === "string"
          ? (remap.get(window.parent_session_key) ?? threadKey)
          : null,
      spawned_by:
        typeof window.spawned_by === "string"
          ? (remap.get(window.spawned_by) ?? window.spawned_by)
          : null,
    });
  }
  for (const id of ids) {
    if (!id) continue;
    for (const table of SESSION_ID_TABLES) {
      const copied = rows(db, source.alias, table, "session_id", id);
      if (copied.length && !tableExists(db, destination.alias, table))
        throw new Error(`Missing contact migration target table: ${table}`);
      for (const row of copied) {
        if (table === "session_conversations" && typeof row.conversation_id === "string") {
          copyConversation(db, source, destination, row.conversation_id);
        }
        insert(db, destination.alias, table, {
          ...row,
          session_id: idMap.get(id)!,
          ...(table === "session_transcript_index_state" ? { needs_rebuild: 1 } : {}),
          ...(table === "context_engine_turn_outbox" && typeof row.advancement_key === "string"
            ? { advancement_key: `${row.advancement_key}:${idMap.get(id)!}` }
            : {}),
        });
      }
    }
  }
  for (const table of SESSION_KEY_TABLES) {
    const copied = rows(db, source.alias, table, "session_key", key);
    if (copied.length && !tableExists(db, destination.alias, table))
      throw new Error(`Missing contact migration target table: ${table}`);
    for (const row of copied) {
      insert(
        db,
        destination.alias,
        table,
        {
          ...row,
          session_key: targetKey,
          ...(typeof row.session_id === "string"
            ? { session_id: idMap.get(row.session_id) ?? row.session_id }
            : {}),
          ...(table === "heartbeat_outcomes" && row.run_session_key === key
            ? { run_session_key: targetKey }
            : {}),
          ...(table === "session_suggestions"
            ? {
                id: `${row.id}-${createHash("sha256").update(targetKey).digest("hex").slice(0, 8)}`,
              }
            : {}),
          ...(table === "session_pending_inputs" && typeof row.input_id === "string"
            ? {
                input_id: `${row.input_id}-${createHash("sha256").update(targetKey).digest("hex").slice(0, 8)}`,
              }
            : {}),
        },
        table === "session_pending_inputs" ? ["seq"] : [],
      );
    }
  }
}

/** Doctor/startup contact repair. Source rows remain archived as durable move claims. */
export function migrateContacts(params: {
  cfg: BranchConfig;
  env?: NodeJS.ProcessEnv;
  apply: boolean;
  now?: number;
  beforeCommit?: () => void;
}): { moved: number; archivedEmpty: number } {
  const env = params.env ?? process.env;
  const selectedDefault =
    tryResolveContactDefaultAgentId(params.cfg) ?? tryResolveDefaultAgentId(params.cfg);
  if (!selectedDefault) return { moved: 0, archivedEmpty: 0 };
  const defaultAgentId = normalizeAgentId(selectedDefault);
  const destinationStorePath = resolveSessionStorePathCore(params.cfg.session?.store, {
    agentId: defaultAgentId,
    env,
  });
  const destinationPath = resolveSqliteTargetFromSessionStorePath(destinationStorePath, {
    agentId: defaultAgentId,
    defaultAgentId,
    env,
  }).path;
  const targets = listExistingAgentDatabaseTargets(params.cfg, env);
  const legacyPath = resolveSqliteTargetFromSessionStorePath(
    resolveSessionStorePathCore(params.cfg.session?.store, { agentId: "main", env }),
    { agentId: "main", defaultAgentId, env },
  ).path;
  const paths = new Map<string, string>();
  for (const target of targets) paths.set(target.sqlitePath, target.agentId);
  if (fs.existsSync(legacyPath)) paths.set(legacyPath, "main");
  if (paths.size === 0) return { moved: 0, archivedEmpty: 0 };
  if (params.apply) {
    openBranchAgentDatabase({ agentId: defaultAgentId, path: destinationPath, env });
    paths.set(destinationPath, defaultAgentId);
  }
  const state = openBranchStateDatabase({ env });
  const allStores: Store[] = [...paths].map(([path, agentId], index) => ({
    path,
    agentId,
    alias: `contact_migration_${index}`,
  }));
  const destination = allStores.find((store) => store.path === destinationPath);
  // Leave one slot free for SQLite's implicit databases, even with a large agent roster.
  const sources = allStores.filter((store) => store !== destination);
  const batches: Store[][] = [];
  for (let index = 0; index < sources.length; index += 8)
    batches.push([...(destination ? [destination] : []), ...sources.slice(index, index + 8)]);
  if (batches.length === 0 && destination) batches.push([destination]);
  const totals = { moved: 0, archivedEmpty: 0 };
  for (const stores of batches) {
    const attached: Store[] = [];
    try {
      for (const store of stores) {
        state.db.prepare(`ATTACH DATABASE ? AS ${quote(store.alias)}`).run(store.path);
        attached.push(store);
      }
      const migrate = (db: DatabaseSync) => {
        const now = params.now ?? Date.now();
        const existingKeys = new Set(
          destination
            ? (
                db
                  .prepare(`SELECT session_key FROM ${quote(destination.alias)}.session_nodes`)
                  .all() as Array<{ session_key: string }>
              ).map((row) => row.session_key)
            : [],
        );
        const candidates: Move[] = [];
        const empties: Array<{ store: Store; key: string; entry: SessionEntry }> = [];
        const mainIsImplicit = !listAgentIds(params.cfg).map(normalizeAgentId).includes("main");
        for (const store of stores) {
          for (const { key, entry } of sourceRows(db, store)) {
            if (entry.movedToSessionKey) continue;
            const parsed = parseAgentSessionKey(key);
            if (!parsed) continue;
            const isCanonicalMain =
              key ===
              resolveCanonicalMainSessionKey({
                agentId: parsed.agentId,
                mainKey: params.cfg.session?.mainKey,
              });
            if (
              !isCanonicalMain &&
              !entry.archivedAt &&
              entry.createdVia === "operator" &&
              !entry.label?.trim() &&
              !entry.topicName?.trim() &&
              !entry.displayName?.trim() &&
              !hasMessages(db, store, key, entry)
            ) {
              empties.push({ store, key, entry });
              continue;
            }
            const legacy =
              mainIsImplicit &&
              normalizeAgentId(parsed.agentId) === "main" &&
              defaultAgentId !== "main";
            const brand =
              normalizeAgentId(parsed.agentId) !== defaultAgentId &&
              [entry.label, entry.displayName, entry.subject].some(
                (value) => value?.trim() === "Branch",
              );
            if (!legacy && !brand) continue;
            const natural = `agent:${defaultAgentId}:${parsed.rest}`;
            const suffix = createHash("sha256")
              .update(`${store.path}\0${key}`)
              .digest("hex")
              .slice(0, 16);
            const targetKey =
              legacy && !existingKeys.has(natural)
                ? natural
                : `agent:${defaultAgentId}:legacy-${suffix}`;
            if (existingKeys.has(targetKey))
              throw new Error(`Contact migration target collision: ${targetKey}`);
            existingKeys.add(targetKey);
            candidates.push({ source: store, key, targetKey, entry });
          }
        }
        if (!params.apply) return { moved: candidates.length, archivedEmpty: empties.length };
        if (candidates.length && !destination)
          throw new Error("Contact migration destination is missing");
        const remap = new Map(candidates.map((move) => [move.key, move.targetKey]));
        const threadKey = resolveCanonicalMainSessionKey({
          agentId: defaultAgentId,
          mainKey: params.cfg.session?.mainKey,
        });
        const audit = createSqliteAuditRecordKernel(db, {
          scope: SYSTEM_AGENT_AUDIT_SCOPE,
          maxEntries: SYSTEM_AGENT_AUDIT_MAX_ENTRIES,
        });
        for (const move of candidates) {
          copyMove(db, move, destination!, remap, threadKey);
          updateNode(db, move.source, move.key, {
            ...move.entry,
            archivedAt: now,
            archiveReason: "moved",
            movedToSessionKey: move.targetKey,
          });
          const claimKey = `contacts-migration:${createHash("sha256").update(`${move.source.path}\0${move.key}`).digest("hex")}`;
          const report = JSON.stringify({
            sourceKey: move.key,
            targetKey: move.targetKey,
            sourcePath: move.source.path,
          });
          db.prepare(
            `INSERT INTO migration_runs (id,started_at,finished_at,status,report_json) VALUES (?,?,?,?,?)`,
          ).run(claimKey, now, now, "completed", report);
          db.prepare(
            `INSERT INTO migration_sources (source_key,migration_kind,target_table,source_path,source_sha256,source_size_bytes,source_record_count,last_run_id,status,imported_at,removed_source,report_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          ).run(
            claimKey,
            "contacts-migration-v1",
            "session_nodes",
            move.source.path,
            null,
            null,
            1,
            claimKey,
            "completed",
            now,
            0,
            report,
          );
          audit.register(
            prepareSqliteAuditRecord(SYSTEM_AGENT_AUDIT_SCOPE, {
              key: claimKey,
              createdAt: now,
              value: {
                timestamp: new Date(now).toISOString(),
                operation: "contacts.migrate",
                summary: `Moved conversation ${move.key} under ${defaultAgentId}`,
                details: { sourceKey: move.key, targetKey: move.targetKey },
              },
            }),
          );
        }
        for (const empty of empties)
          updateNode(db, empty.store, empty.key, {
            ...empty.entry,
            archivedAt: now,
            archiveReason: "empty",
          });
        params.beforeCommit?.();
        return { moved: candidates.length, archivedEmpty: empties.length };
      };
      const result = params.apply
        ? runBranchStateWriteTransaction(
            ({ db }) => migrate(db),
            { env },
            { operationLabel: "contacts-migration" },
          )
        : migrate(state.db);
      totals.moved += result.moved;
      totals.archivedEmpty += result.archivedEmpty;
    } finally {
      for (const store of attached.toReversed())
        state.db.exec(`DETACH DATABASE ${quote(store.alias)}`);
    }
  }
  return totals;
}
