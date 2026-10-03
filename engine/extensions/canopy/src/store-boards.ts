import type {
  CanopyBoardMetadata,
  CanopyBoardSummary,
  CanopySessionPlacement,
  CanopySessionsBoard,
  CanopySessionsBoardSpec,
} from "@branch/canopy-contract";
import type {
  PersistedCanopyAttachment,
  PersistedCanopyBoard,
  CanopyCardStore,
  CanopyKeyedStore,
  CanopySessionPlacementWrite,
  CanopySessionsBoardStore,
  CanopySubscriptionStore,
  CanopyWriteAuthority,
} from "./persistence-types.js";
import { normalizeBoardMetadata } from "./store-board-normalizers.js";
import type { CanopyBoardInput } from "./store-inputs.js";
import { normalizeBoardIdRequired } from "./store-normalizers.js";
import { CanopyStoreRuntime } from "./store-runtime.js";

export class CanopyBoardStore extends CanopyStoreRuntime {
  protected readonly store: CanopyCardStore;
  protected readonly boardStore: CanopyKeyedStore<PersistedCanopyBoard>;
  protected readonly subscriptionStore: CanopySubscriptionStore;
  protected readonly attachmentStore: CanopyKeyedStore<PersistedCanopyAttachment>;
  private readonly sessionsBoardStore: CanopySessionsBoardStore;

  constructor(
    store: CanopyCardStore,
    stores: {
      boards: CanopyKeyedStore<PersistedCanopyBoard>;
      sessionsBoard: CanopySessionsBoardStore;
      subscriptions: CanopySubscriptionStore;
      attachments: CanopyKeyedStore<PersistedCanopyAttachment>;
      ready?: Promise<number>;
      dataVersion?: () => number | Promise<number>;
      close?: () => void | Promise<void>;
      runWithWriteAuthority?: CanopyWriteAuthority;
    },
  ) {
    super(stores.dataVersion, stores.close, stores.ready, stores.runWithWriteAuthority);
    this.store = this.trackCardStore(store);
    this.boardStore = this.track(stores.boards);
    this.sessionsBoardStore = stores.sessionsBoard;
    this.subscriptionStore = {
      ...this.track(stores.subscriptions, { notifyChanges: false }),
      entries: (options) => this.runOperation(() => stores.subscriptions.entries(options)),
    };
    this.attachmentStore = this.track(stores.attachments, { notifyChanges: false });
  }

  async listBoards(): Promise<{ boards: CanopyBoardSummary[] }> {
    const boards = new Map<string, CanopyBoardSummary>();
    for (const entry of await this.boardStore.entries()) {
      if (entry.value?.version !== 1 || !entry.value.board?.id) {
        continue;
      }
      const board = entry.value.board;
      boards.set(board.id, {
        id: board.id,
        ...(board.kind ? { kind: board.kind } : {}),
        ...(board.kind === "sessions" ? { sessions: board.sessions } : {}),
        ...(board.name ? { name: board.name } : {}),
        ...(board.description ? { description: board.description } : {}),
        ...(board.icon ? { icon: board.icon } : {}),
        ...(board.color ? { color: board.color } : {}),
        ...(board.automationJobId ? { automationJobId: board.automationJobId } : {}),
        ...(board.defaultWorkspace ? { defaultWorkspace: board.defaultWorkspace } : {}),
        ...(board.orchestration ? { orchestration: board.orchestration } : {}),
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
        updatedAt: board.updatedAt,
        ...(board.archivedAt ? { archivedAt: board.archivedAt } : {}),
      });
    }
    if (!boards.has("default")) {
      boards.set("default", {
        id: "default",
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
      });
    }
    const cardAggregates = await this.store.listBoardAggregates();
    for (const aggregate of cardAggregates) {
      const boardId = aggregate.boardId;
      const summary =
        boards.get(boardId) ??
        ({
          id: boardId,
          total: 0,
          active: 0,
          archived: 0,
          byStatus: {},
        } satisfies CanopyBoardSummary);
      summary.total += aggregate.total;
      summary.archived += aggregate.archived;
      summary.active += aggregate.total - aggregate.archived;
      summary.byStatus[aggregate.status] =
        (summary.byStatus[aggregate.status] ?? 0) + aggregate.total;
      summary.updatedAt = Math.max(summary.updatedAt ?? 0, aggregate.updatedAt);
      boards.set(boardId, summary);
    }
    return {
      boards: [...boards.values()].toSorted((a, b) =>
        a.id === "default" ? -1 : b.id === "default" ? 1 : a.id.localeCompare(b.id),
      ),
    };
  }

  async upsertBoard(input: CanopyBoardInput): Promise<CanopyBoardMetadata> {
    return await this.enqueueMutation(async () => {
      const id = normalizeBoardIdRequired(input.id);
      const existing = await this.boardStore.lookup(id);
      const board = normalizeBoardMetadata({ ...input, id }, existing?.board);
      await this.boardStore.register(id, { version: 1, board });
      return board.kind === "sessions" ? await this.getSessionsBoard(id) : board;
    });
  }

  getSessionsBoard(boardId: string): Promise<CanopySessionsBoard> {
    return this.runOperation(() => this.sessionsBoardStore.get(normalizeBoardIdRequired(boardId)));
  }

  updateSessionsBoard(
    boardId: string,
    patch: unknown,
    assertCurrent?: () => void,
  ): Promise<CanopySessionsBoard> {
    return this.enqueueMutation(
      () =>
        this.trackMutation(
          () => this.sessionsBoardStore.update(normalizeBoardIdRequired(boardId), patch),
          () => true,
        ),
      assertCurrent,
    );
  }

  listSessionPlacements(boardId: string): Promise<CanopySessionPlacement[]> {
    return this.runOperation(() =>
      this.sessionsBoardStore.listPlacements(normalizeBoardIdRequired(boardId)),
    );
  }

  writeSessionPlacements(
    boardId: string,
    placements: CanopySessionPlacementWrite[],
    options: { expectedSpec: CanopySessionsBoardSpec; assertCurrent?: () => void },
  ): Promise<boolean> {
    return this.enqueueMutation(
      () =>
        this.trackMutation(
          () =>
            this.sessionsBoardStore.writePlacements(
              normalizeBoardIdRequired(boardId),
              placements,
              options.expectedSpec,
            ),
          (written) => written && placements.length > 0,
        ),
      options.assertCurrent,
    );
  }

  async assertCardsBoard(boardId: string): Promise<void> {
    if (
      (await this.boardStore.lookup(normalizeBoardIdRequired(boardId)))?.board.kind === "sessions"
    ) {
      throw new Error("Sessions boards do not hold cards");
    }
  }

  async archiveBoard(id: unknown, archived: unknown = true): Promise<CanopyBoardMetadata> {
    return await this.upsertBoard({ id, archived });
  }

  async deleteBoard(id: unknown): Promise<{ deleted: boolean }> {
    return await this.enqueueMutation(async () => {
      const boardId = normalizeBoardIdRequired(id);
      if (boardId === "default") {
        throw new Error("default board cannot be deleted.");
      }
      if (await this.store.hasCards(boardId)) {
        throw new Error("board still has cards; archive it or move/delete the cards first.");
      }
      for (const entry of await this.subscriptionStore.entries({ boardId })) {
        if (entry.value?.version === 1 && entry.value.subscription?.boardId === boardId) {
          await this.subscriptionStore.delete(entry.key);
        }
      }
      return { deleted: await this.boardStore.delete(boardId) };
    });
  }
}
