import type {
  CanopyAttachment,
  CanopyBoardMetadata,
  CanopyCard,
  CanopyNotificationSubscription,
  CanopySessionPlacement,
  CanopySessionsBoard,
  CanopySessionsBoardSpec,
} from "@branch/canopy-contract";

/**
 * Guard the first accepted write (including CAS retries), then allow its settlement.
 * Independently authorized effects need separate scopes; settled scopes cannot be reused.
 */
export type CanopyWriteAuthority = <T>(
  assertCurrent: () => void,
  run: () => Promise<T>,
) => Promise<T>;

export type PersistedCanopyCard = {
  version: 1;
  card: CanopyCard;
};

export type PersistedCanopyBoard = {
  version: 1;
  board: CanopyBoardMetadata;
};

export type PersistedCanopyNotificationSubscription = {
  version: 1;
  subscription: CanopyNotificationSubscription;
};

export type PersistedCanopyAttachment = {
  version: 1;
  attachment: CanopyAttachment;
  contentBase64: string;
};

export type CanopyKeyedStore<T = PersistedCanopyCard> = {
  register(key: string, value: T): Promise<void>;
  lookup(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<Array<{ key: string; value: T }>>;
};

export type CanopySessionPlacementWrite = CanopySessionPlacement & {
  source: "operator";
  /** Undefined requires an absent row; otherwise compare the last observed revision. */
  expectedUpdatedAt?: number;
};

export type CanopySessionsBoardStore = {
  get(boardId: string): Promise<CanopySessionsBoard>;
  update(boardId: string, patch: unknown): Promise<CanopySessionsBoard>;
  listPlacements(boardId: string): Promise<CanopySessionPlacement[]>;
  repairPlacements(): Promise<{ placements: number; boards: number }>;
  writePlacement(
    boardId: string,
    placement: CanopySessionPlacementWrite,
    expectedSpec: CanopySessionsBoardSpec,
  ): Promise<boolean>;
};

export type CanopySubscriptionStore = Omit<
  CanopyKeyedStore<PersistedCanopyNotificationSubscription>,
  "entries"
> & {
  entries(options?: {
    boardId?: string;
    cardId?: string;
  }): Promise<Array<{ key: string; value: PersistedCanopyNotificationSubscription }>>;
};

type CanopyBoardCardAggregate = {
  boardId: string;
  status: CanopyCard["status"];
  total: number;
  archived: number;
  updatedAt: number;
};

export type CanopyCardStatsAggregate = {
  status: CanopyCard["status"];
  agentId: string | undefined;
  total: number;
  archived: number;
  updatedAt: number;
  oldestReadyAt: number | undefined;
};

export type CanopyOwnerClaimResult = "updated" | "conflict" | "owner_busy";

export type CanopyCardReadScope =
  | { kind: "board"; boardId: string }
  | { kind: "session"; sessionKey: string }
  | {
      kind: "worker-context";
      cardId: string;
      boardId: string;
      agentId?: string;
      parentIds: readonly string[];
    };

export type CanopyCardStore = Omit<CanopyKeyedStore, "entries"> & {
  entries(
    scope?: CanopyCardReadScope,
  ): Promise<Array<{ key: string; value: PersistedCanopyCard }>>;
  registerIfAbsent(key: string, value: PersistedCanopyCard): Promise<boolean>;
  registerIfUpdatedAt(
    key: string,
    value: PersistedCanopyCard,
    expectedUpdatedAt: number,
  ): Promise<boolean>;
  deleteIfUpdatedAt(key: string, expectedUpdatedAt: number): Promise<boolean>;
  claimIfOwnerAvailable(
    key: string,
    value: PersistedCanopyCard,
    expectedUpdatedAt: number,
    ownerId: string,
    now: number,
  ): Promise<CanopyOwnerClaimResult>;
  listCardStatuses(ids: readonly string[]): Promise<Array<{ id: string; status: string }>>;
  listBoardAggregates(): Promise<CanopyBoardCardAggregate[]>;
  listStatsAggregates(boardId?: string): Promise<CanopyCardStatsAggregate[]>;
  hasCards(boardId: string): Promise<boolean>;
};
