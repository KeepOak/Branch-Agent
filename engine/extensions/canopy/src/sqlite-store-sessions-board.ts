import type { DatabaseSync } from "node:sqlite";
import {
  createDefaultCanopySessionsBoardSpec,
  normalizeCanopySessionsBoardSpec,
  patchCanopySessionsBoardSpec,
  type CanopySessionPlacement,
  type CanopySessionsBoard,
  type CanopySessionsBoardSpec,
} from "@branch/canopy-contract";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
  iterateSqliteQuerySync,
  runSqliteImmediateTransactionSync,
} from "branch/plugin-sdk/sqlite-worker-runtime";
import type {
  PersistedCanopyBoard,
  CanopySessionPlacementWrite,
} from "./persistence-types.js";

type SessionsBoardDatabase = {
  canopy_boards: { id: string; kind: string; sessions_spec: string | null; updated_at: number };
  canopy_session_placements: {
    board_id: string;
    session_key: string;
    column_id: string;
    source: CanopySessionPlacement["source"];
    reason: string;
    facts_hash: string;
    updated_at: number;
  };
};

// Match the previous defaults as persisted by contract normalization, including field/value order.
const PREVIOUS_DEFAULT_RULES = new Map(
  Object.entries({
    "needs-input": { health: ["waiting-on-user"] },
    working: { health: ["on-track", "grinding", "wrapping-up"], run: ["active"] },
    stuck: { health: ["stuck", "failed"] },
    "in-review": { pullRequest: ["open", "draft"] },
    merged: { pullRequest: ["merged"] },
    done: { health: ["done"] },
  }).map(([id, match]) => [id, JSON.stringify(match)]),
);

export class CanopySqliteSessionsBoardStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly boards: { lookup(key: string): PersistedCanopyBoard | undefined },
  ) {}

  get(boardId: string): CanopySessionsBoard {
    const board = this.boards.lookup(boardId)?.board;
    if (!board) {
      throw new Error(`board not found: ${boardId}`);
    }
    if (board.kind !== "sessions" || !board.sessions) {
      throw new Error("This board is not a Sessions board.");
    }
    return { ...board, kind: "sessions", sessions: board.sessions };
  }

  update(boardId: string, patch: unknown): CanopySessionsBoard {
    return runSqliteImmediateTransactionSync(this.db, () => {
      const current = this.get(boardId);
      const sessions = patchCanopySessionsBoardSpec(current.sessions, patch);
      const updatedAt = Math.max(Date.now(), current.updatedAt + 1);
      executeSqliteQuerySync(
        this.db,
        getNodeSqliteKysely<SessionsBoardDatabase>(this.db)
          .updateTable("canopy_boards")
          .set({ sessions_spec: JSON.stringify(sessions), updated_at: updatedAt })
          .where("id", "=", boardId),
      );
      return { ...current, sessions, updatedAt };
    });
  }

  listPlacements(boardId: string): CanopySessionPlacement[] {
    const query = getNodeSqliteKysely<SessionsBoardDatabase>(this.db)
      .selectFrom("canopy_session_placements")
      .selectAll()
      .where("board_id", "=", boardId)
      .orderBy("session_key", "asc");
    return Array.from(iterateSqliteQuerySync(this.db, query), (row) => ({
      sessionKey: row.session_key,
      columnId: row.column_id,
      source: row.source,
      reason: row.reason,
      factsHash: row.facts_hash,
      updatedAt: row.updated_at,
    }));
  }

  repairPlacements(): { placements: number; boards: number } {
    return runSqliteImmediateTransactionSync(this.db, () => {
      const query = getNodeSqliteKysely<SessionsBoardDatabase>(this.db);
      const placements = Number(
        executeSqliteQuerySync(
          this.db,
          query.deleteFrom("canopy_session_placements").where("source", "!=", "operator"),
        ).numAffectedRows ?? 0n,
      );
      const defaults = createDefaultCanopySessionsBoardSpec().columns;
      let boards = 0;
      for (const { id } of executeSqliteQuerySync(
        this.db,
        query.selectFrom("canopy_boards").select("id").where("kind", "=", "sessions"),
      ).rows) {
        const board = this.get(id);
        if (
          board.sessions.columns.some((column) => {
            const previous = PREVIOUS_DEFAULT_RULES.get(column.id);
            return previous === undefined || JSON.stringify(column.match) !== previous;
          })
        ) {
          continue;
        }
        const columns = board.sessions.columns.map((column) => ({
          ...column,
          match: defaults.find((entry) => entry.id === column.id)?.match,
        }));
        if (
          columns.map((column) => column.id).join(",") ===
          [...PREVIOUS_DEFAULT_RULES.keys()].join(",")
        ) {
          columns.splice(1, 0, ...columns.splice(2, 1));
        }
        if (JSON.stringify(columns) !== JSON.stringify(board.sessions.columns)) {
          this.update(id, { columns });
          boards += 1;
        }
      }
      return { placements, boards };
    });
  }

  writePlacement(
    boardId: string,
    placement: CanopySessionPlacementWrite,
    expectedSpec: CanopySessionsBoardSpec,
  ): boolean {
    const expected = JSON.stringify(normalizeCanopySessionsBoardSpec(expectedSpec));
    return runSqliteImmediateTransactionSync(this.db, () => {
      const board = this.get(boardId);
      if (JSON.stringify(board.sessions) !== expected) {
        return false;
      }
      if (!board.sessions.columns.some((column) => column.id === placement.columnId)) {
        throw new Error(`Unknown sessions board column: ${placement.columnId}`);
      }
      if (
        !placement.sessionKey ||
        placement.source !== "operator" ||
        typeof placement.reason !== "string" ||
        !Number.isSafeInteger(placement.updatedAt) ||
        placement.updatedAt < 0
      ) {
        throw new Error("Invalid session pin.");
      }
      const query = getNodeSqliteKysely<SessionsBoardDatabase>(this.db);
      const current = executeSqliteQueryTakeFirstSync(
        this.db,
        query
          .selectFrom("canopy_session_placements")
          .select("updated_at")
          .where("board_id", "=", boardId)
          .where("session_key", "=", placement.sessionKey),
      );
      if (current?.updated_at !== placement.expectedUpdatedAt) {
        return false;
      }
      executeSqliteQuerySync(
        this.db,
        query
          .insertInto("canopy_session_placements")
          .values({
            board_id: boardId,
            session_key: placement.sessionKey,
            column_id: placement.columnId,
            source: "operator",
            reason: placement.reason,
            facts_hash: "",
            updated_at: Math.max(placement.updatedAt, (current?.updated_at ?? -1) + 1),
          })
          .onConflict((conflict) =>
            conflict.columns(["board_id", "session_key"]).doUpdateSet((eb) => ({
              column_id: eb.ref("excluded.column_id"),
              source: eb.ref("excluded.source"),
              reason: eb.ref("excluded.reason"),
              facts_hash: eb.ref("excluded.facts_hash"),
              updated_at: eb.ref("excluded.updated_at"),
            })),
          ),
      );
      return true;
    });
  }
}
