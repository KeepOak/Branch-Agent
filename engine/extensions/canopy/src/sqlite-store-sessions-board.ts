import type { DatabaseSync } from "node:sqlite";
import {
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
  canopy_boards: { id: string; sessions_spec: string | null; updated_at: number };
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

  writePlacements(
    boardId: string,
    placements: CanopySessionPlacementWrite[],
    expectedSpec: CanopySessionsBoardSpec,
  ): boolean {
    const expected = JSON.stringify(normalizeCanopySessionsBoardSpec(expectedSpec));
    return runSqliteImmediateTransactionSync(this.db, () => {
      const board = this.get(boardId);
      if (JSON.stringify(board.sessions) !== expected) {
        return false;
      }
      const query = getNodeSqliteKysely<SessionsBoardDatabase>(this.db);
      const columns = new Set(board.sessions.columns.map((column) => column.id));
      const keys = new Set<string>();
      const revisions = new Map<string, number>();
      for (const placement of placements) {
        if (!columns.has(placement.columnId)) {
          throw new Error(`Unknown sessions board column: ${placement.columnId}`);
        }
        if (!placement.sessionKey || keys.has(placement.sessionKey)) {
          throw new Error("Session placement keys must be non-empty and unique.");
        }
        keys.add(placement.sessionKey);
        if (
          !["state", "model", "operator"].includes(placement.source) ||
          typeof placement.reason !== "string" ||
          !placement.factsHash ||
          !Number.isSafeInteger(placement.updatedAt) ||
          placement.updatedAt < 0
        ) {
          throw new Error("Invalid session placement.");
        }
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
        revisions.set(
          placement.sessionKey,
          Math.max(placement.updatedAt, (current?.updated_at ?? -1) + 1),
        );
      }
      // Compare every row before writing any, so a late model batch cannot undo an operator move.
      for (const placement of placements) {
        executeSqliteQuerySync(
          this.db,
          query
            .insertInto("canopy_session_placements")
            .values({
              board_id: boardId,
              session_key: placement.sessionKey,
              column_id: placement.columnId,
              source: placement.source,
              reason: placement.reason,
              facts_hash: placement.factsHash,
              updated_at: revisions.get(placement.sessionKey) ?? placement.updatedAt,
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
      }
      return true;
    });
  }
}
