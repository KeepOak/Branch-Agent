import { coerceErrorMessage } from "@branch/normalization-core";
import { setConfiguredMcpServer } from "../agents/mcp-config-mutation.js";
import { withGroveMcpLifecycleLease } from "../agents/mcp-lifecycle-lease.js";
import { canonicalizeConfiguredMcpServer } from "../config/mcp-config-normalize.js";
import { listConfiguredMcpServers } from "../config/mcp-config.js";
import {
  compileSqliteQueryBindings,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { digestGroveValue } from "./digest.js";
import {
  GROVE_MCP_REF_SCHEMA_VERSION,
  refToRow,
  rowToRef,
  selectMcpRefs,
  type McpDatabase,
  type McpRefRow,
  type PersistedGroveMcpServerRef,
} from "./mcp-records.js";
import type { GroveReferencedCleanup } from "./package-remove.js";
import { reconcileGroveMcpServerRefsInWorker } from "./provenance-write.js";
import type { GroveAddPlan, GroveMcpServer } from "./types.js";

export { GROVE_MCP_REF_SCHEMA_VERSION, type PersistedGroveMcpServerRef } from "./mcp-records.js";

export class GroveMcpInstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly mcpServers: PersistedGroveMcpServerRef[],
  ) {
    super(message);
    this.name = "GroveMcpInstallError";
  }
}

function mcpServerFromActionDetails(details: Record<string, unknown>): GroveMcpServer | undefined {
  const { expectedState: _expectedState, prerequisites: _prerequisites, ...server } = details;
  return "command" in server || "url" in server ? (server as GroveMcpServer) : undefined;
}

export function digestGroveMcpServer(server: Record<string, unknown>): string {
  return digestGroveValue(canonicalizeConfiguredMcpServer(server));
}

function persistPendingRef(
  plan: GroveAddPlan,
  name: string,
  server: GroveMcpServer,
  ownership: Pick<PersistedGroveMcpServerRef, "relationship" | "origin" | "independentOwner">,
  options: BranchStateDatabaseOptions & { nowMs?: number },
): PersistedGroveMcpServerRef {
  const nowMs = options.nowMs ?? Date.now();
  const configDigest = digestGroveMcpServer(server);
  const database = openBranchStateDatabase(options);
  const { compiled, bind } = compileSqliteQueryBindings<{ agentId: string; name: string }>(
    (parameter) =>
      selectMcpRefs(database.db)
        .where(
          "agent_id",
          "=",
          parameter((value) => value.agentId),
        )
        .where(
          "name",
          "=",
          parameter((value) => value.name),
        ),
  );
  const existing =
    database.db /* sqlite-allow-raw: preserve native point-read errors outside the write transaction. */
      .prepare(compiled.sql)
      // SAFETY: The canonical table and explicit projection provide this generated row shape.
      .get(...bind({ agentId: plan.agent.finalId, name })) as McpRefRow | undefined;
  if (existing) {
    const ref = rowToRef(existing);
    if (ref.configDigest !== configDigest || ref.status === "failed") {
      throw new GroveMcpInstallError(
        "mcp_provenance_conflict",
        `MCP server ${JSON.stringify(name)} differs from its ownership record.`,
        [ref],
      );
    }
    return ref;
  }
  const ref: PersistedGroveMcpServerRef = {
    schemaVersion: GROVE_MCP_REF_SCHEMA_VERSION,
    agentId: plan.agent.finalId,
    name,
    configDigest,
    ...ownership,
    status: "pending",
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<McpDatabase>(db).insertInto("grove_mcp_server_refs").values(refToRow(ref)),
    );
  }, options);
  return ref;
}

function updateRef(
  ref: PersistedGroveMcpServerRef,
  update: { status: PersistedGroveMcpServerRef["status"]; error?: string },
  options: BranchStateDatabaseOptions & { nowMs?: number },
): PersistedGroveMcpServerRef {
  const updated = { ...ref, ...update, updatedAtMs: options.nowMs ?? Date.now() };
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<McpDatabase>(db)
        .updateTable("grove_mcp_server_refs")
        .set({
          status: update.status,
          error: update.error ?? null,
          updated_at_ms: updated.updatedAtMs,
        })
        .where("agent_id", "=", ref.agentId)
        .where("name", "=", ref.name),
    );
  }, options);
  return updated;
}

export async function installGroveMcpServers(
  plan: GroveAddPlan,
  options: BranchStateDatabaseOptions & {
    setMcpServer?: (params: {
      name: string;
      server: GroveMcpServer;
      createOnly?: boolean;
    }) => ReturnType<typeof setConfiguredMcpServer>;
    listMcpServers?: typeof listConfiguredMcpServers;
    nowMs?: number;
  } = {},
): Promise<PersistedGroveMcpServerRef[]> {
  const setMcpServer = options.setMcpServer ?? setConfiguredMcpServer;
  const listMcpServers = options.listMcpServers ?? listConfiguredMcpServers;
  const refs: PersistedGroveMcpServerRef[] = [];
  for (const action of plan.actions.filter((candidate) => candidate.kind === "mcpServer")) {
    await withGroveMcpLifecycleLease(action.id, options, async () => {
      const server = action.details ? mcpServerFromActionDetails(action.details) : undefined;
      if (!server) {
        throw new GroveMcpInstallError(
          "mcp_plan_invalid",
          `MCP server action ${JSON.stringify(action.id)} is invalid.`,
          refs,
        );
      }
      const listed = await listMcpServers();
      if (!listed.ok) {
        throw new GroveMcpInstallError("mcp_preflight_failed", listed.error, refs);
      }
      const configured = listed.mcpServers[action.id];
      const configDigest = digestGroveMcpServer(server);
      if (configured && digestGroveMcpServer(configured) !== configDigest) {
        throw new GroveMcpInstallError(
          "mcp_config_conflict",
          `MCP server ${JSON.stringify(action.id)} already exists with different configuration.`,
          refs,
        );
      }
      const existingRefs = readGroveMcpServerRefsByName(action.id, options);
      const inheritsGroveOrigin =
        existingRefs.length > 0 &&
        existingRefs.every(
          (candidate) => candidate.origin === "grove-introduced" && !candidate.independentOwner,
        );
      const ownership = configured
        ? {
            relationship: "referenced" as const,
            origin: inheritsGroveOrigin ? ("grove-introduced" as const) : ("pre-existing" as const),
            independentOwner: !inheritsGroveOrigin,
          }
        : {
            relationship: "managed" as const,
            origin: "grove-introduced" as const,
            independentOwner: false,
          };
      let pending = persistPendingRef(plan, action.id, server, ownership, options);
      refs.push(pending);
      if (pending.status === "complete") {
        if (configured) {
          return;
        }
        const hasSiblingOwner = readGroveMcpServerRefsByName(action.id, options).some(
          (candidate) => candidate.agentId !== plan.agent.finalId,
        );
        if (
          pending.relationship !== "managed" ||
          pending.origin !== "grove-introduced" ||
          pending.independentOwner ||
          hasSiblingOwner
        ) {
          throw new GroveMcpInstallError(
            "mcp_reconcile_conflict",
            `MCP server ${JSON.stringify(action.id)} was removed while shared or independently owned and will not be recreated.`,
            refs,
          );
        }
        pending = updateRef(pending, { status: "pending" }, options);
        refs[refs.length - 1] = pending;
      }
      if (configured) {
        refs[refs.length - 1] = updateRef(pending, { status: "complete" }, options);
        return;
      }
      let result: Awaited<ReturnType<typeof setConfiguredMcpServer>>;
      try {
        result = await setMcpServer({
          name: action.id,
          server,
          createOnly: true,
          recordIndependentOwner: false,
        });
      } catch (error) {
        const message = coerceErrorMessage(error);
        throw new GroveMcpInstallError("mcp_install_uncertain", message, refs);
      }
      if (!result.ok) {
        refs[refs.length - 1] = updateRef(
          pending,
          { status: "failed", error: result.error },
          options,
        );
        throw new GroveMcpInstallError("mcp_install_failed", result.error, refs);
      }
      try {
        refs[refs.length - 1] = updateRef(pending, { status: "complete" }, options);
      } catch (error) {
        const message = coerceErrorMessage(error);
        throw new GroveMcpInstallError(
          "mcp_provenance_failed",
          `MCP server was configured, but ownership could not be persisted: ${message}`,
          refs,
        );
      }
    });
  }
  return refs;
}

export function readGroveMcpServerRefs(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): PersistedGroveMcpServerRef[] {
  const { db } = openBranchStateDatabase(options);
  if (options.readOnly && !tableExists(db, "grove_mcp_server_refs")) {
    return [];
  }
  const { compiled, bind } = compileSqliteQueryBindings<string>((parameter) =>
    selectMcpRefs(db)
      .where(
        "agent_id",
        "=",
        parameter((value) => value),
      )
      .orderBy("name"),
  );
  const rows =
    db /* sqlite-allow-raw: preserve native full-agent inventory errors without a write transaction. */
      .prepare(compiled.sql)
      // SAFETY: The canonical table and explicit projection provide this generated row shape.
      .all(...bind(agentId)) as McpRefRow[];
  return rows.map(rowToRef);
}

export function readGroveMcpServerRefsByName(
  name: string,
  options: BranchStateDatabaseOptions = {},
): PersistedGroveMcpServerRef[] {
  const { db } = openBranchStateDatabase(options);
  if (options.readOnly && !tableExists(db, "grove_mcp_server_refs")) {
    return [];
  }
  const { compiled, bind } = compileSqliteQueryBindings<string>((parameter) =>
    selectMcpRefs(db)
      .where(
        "name",
        "=",
        parameter((value) => value),
      )
      .orderBy("agent_id"),
  );
  const rows =
    db /* sqlite-allow-raw: preserve native sibling-inventory errors without a write transaction. */
      .prepare(compiled.sql)
      // SAFETY: The canonical table and explicit projection provide this generated row shape.
      .all(...bind(name)) as McpRefRow[];
  return rows.map(rowToRef);
}

export function groveMcpRemovalSelector(ref: PersistedGroveMcpServerRef): string {
  return `mcp:${ref.name}`;
}

type GroveMcpServerRemovalDecision = {
  ref: PersistedGroveMcpServerRef;
  action: "remove" | "release";
  blocked: boolean;
  affectedGroveAgentIds: string[];
  reason?: string;
};

export function planGroveMcpServerRemoval(
  ref: PersistedGroveMcpServerRef,
  options: BranchStateDatabaseOptions & { referencedCleanup?: GroveReferencedCleanup } = {},
): GroveMcpServerRemovalDecision {
  const otherRefs = readGroveMcpServerRefsByName(ref.name, options).filter(
    (candidate) => candidate.agentId !== ref.agentId,
  );
  const affectedGroveAgentIds = otherRefs.map((candidate) => candidate.agentId).toSorted();
  const cleanup = options.referencedCleanup ?? { mode: "retain" };
  const explicitlySelected =
    cleanup.mode === "remove-selected" &&
    (cleanup.selected ?? []).includes(groveMcpRemovalSelector(ref));
  const conflicts =
    affectedGroveAgentIds.length > 0 || ref.independentOwner || ref.origin === "pre-existing";
  const release = (reason: string, blocked = false): GroveMcpServerRemovalDecision => ({
    ref,
    action: "release",
    blocked,
    affectedGroveAgentIds,
    reason,
  });

  if (ref.relationship === "managed") {
    if (explicitlySelected) {
      return release(
        "--remove-referenced only accepts resources with a referenced relationship.",
        true,
      );
    }
    if (affectedGroveAgentIds.length > 0) {
      return release("Another Grove still references this MCP server.");
    }
    if (ref.independentOwner) {
      return release("MCP server has a current non-Grove owner.");
    }
    return { ref, action: "remove", blocked: false, affectedGroveAgentIds };
  }
  if (!explicitlySelected && cleanup.mode !== "remove-if-unused") {
    return release("Referenced resources are retained unless a cleanup mode selects them.");
  }
  if (!explicitlySelected && conflicts) {
    return release(
      affectedGroveAgentIds.length > 0
        ? "Another Grove still references this MCP server."
        : "MCP server has a current non-Grove owner or pre-existing origin.",
    );
  }
  if (explicitlySelected && conflicts && !cleanup.allowConflicts) {
    return release(
      "Selected MCP server has other Grove dependents, a non-Grove owner, or pre-existing origin; explicit conflict override is required.",
      true,
    );
  }
  return { ref, action: "remove", blocked: false, affectedGroveAgentIds };
}

export function reconcileGroveMcpServerRefs(
  agentId: string,
  configuredServers: Record<string, Record<string, unknown>>,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): Promise<PersistedGroveMcpServerRef[]> {
  return reconcileGroveMcpServerRefsInWorker(
    agentId,
    Object.fromEntries(
      Object.entries(configuredServers).map(([name, server]) => [
        name,
        digestGroveMcpServer(server),
      ]),
    ),
    options,
  );
}

export function deleteGroveMcpServerRef(
  agentId: string,
  name: string,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<McpDatabase>(db)
        .deleteFrom("grove_mcp_server_refs")
        .where("agent_id", "=", agentId)
        .where("name", "=", name),
    );
  }, options);
}

export function upsertGroveMcpServerRef(
  ref: PersistedGroveMcpServerRef,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<McpDatabase>(db)
        .insertInto("grove_mcp_server_refs")
        .values(refToRow(ref))
        .onConflict((conflict) =>
          conflict.columns(["agent_id", "name"]).doUpdateSet((eb) => ({
            schema_version: eb.ref("excluded.schema_version"),
            config_digest: eb.ref("excluded.config_digest"),
            relationship: eb.ref("excluded.relationship"),
            origin: eb.ref("excluded.origin"),
            independent_owner: eb.ref("excluded.independent_owner"),
            status: eb.ref("excluded.status"),
            error: eb.ref("excluded.error"),
            // Existing claims retain their original creation timestamp through updates and undo.
            updated_at_ms: eb.ref("excluded.updated_at_ms"),
          })),
        ),
    );
  }, options);
}
