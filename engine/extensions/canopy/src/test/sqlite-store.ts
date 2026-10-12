import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeWorkerUrl } from "branch/plugin-sdk/process-runtime";
import { afterEach } from "vitest";
import type {
  PersistedCanopyCard,
  CanopyCardStore,
  CanopyWriteAuthority,
} from "../persistence-types.js";
import { canopySqliteBackendEntrypoint } from "../sqlite-backend-entrypoint.test-support.js";
import { createCanopySqliteStores } from "../sqlite-store.js";
import { CanopyStore } from "../store.js";

const workerModuleUrl = resolveRuntimeWorkerUrl(canopySqliteBackendEntrypoint);

type CanopySqliteTestStores = Omit<
  ReturnType<typeof createCanopySqliteStores>,
  "runWithWriteAuthority"
> & { runWithWriteAuthority?: CanopyWriteAuthority };

type CanopySqliteTestOptions = {
  createStores?: (dbPath: string) => CanopySqliteTestStores;
  beforeCardWrite?: (key: string, value: PersistedCanopyCard) => void | Promise<void>;
  beforeCardLookup?: (key: string) => void | Promise<void>;
  onStoreClose?: () => void | Promise<void>;
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
  if (errors.length > 0) {
    throw new AggregateError(errors, "Canopy SQLite test cleanup failed");
  }
});

function withCardHooks(
  cards: CanopyCardStore,
  options: CanopySqliteTestOptions,
): CanopyCardStore {
  return {
    async register(key, value) {
      await options.beforeCardWrite?.(key, value);
      await cards.register(key, value);
    },
    async registerIfAbsent(key, value) {
      await options.beforeCardWrite?.(key, value);
      return cards.registerIfAbsent(key, value);
    },
    async registerIfUpdatedAt(key, value, expectedUpdatedAt) {
      await options.beforeCardWrite?.(key, value);
      return cards.registerIfUpdatedAt(key, value, expectedUpdatedAt);
    },
    async claimIfOwnerAvailable(key, value, expectedUpdatedAt, ownerId, now) {
      await options.beforeCardWrite?.(key, value);
      return cards.claimIfOwnerAvailable(key, value, expectedUpdatedAt, ownerId, now);
    },
    async lookup(key) {
      await options.beforeCardLookup?.(key);
      return cards.lookup(key);
    },
    delete: (key) => cards.delete(key),
    deleteIfUpdatedAt: (key, expectedUpdatedAt) => cards.deleteIfUpdatedAt(key, expectedUpdatedAt),
    entries: (scope) => cards.entries(scope),
    listCardStatuses: (ids) => cards.listCardStatuses(ids),
    listBoardAggregates: () => cards.listBoardAggregates(),
    listStatsAggregates: (boardId) => cards.listStatsAggregates(boardId),
    hasCards: (boardId) => cards.hasCards(boardId),
  };
}

export function createCanopySqliteTestHarness(options: CanopySqliteTestOptions = {}) {
  // branch-temp-dir: allow closes the SQLite owner before removing database files.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-test-"));
  const dbPath = path.join(dir, "canopy.sqlite");
  let sqlite: CanopySqliteTestStores;
  try {
    sqlite = options.createStores
      ? options.createStores(dbPath)
      : createCanopySqliteStores({ dbPath, workerModuleUrl });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const closeDatabase = () => sqlite.close();
  const stores = {
    ...sqlite,
    cards:
      options.beforeCardWrite || options.beforeCardLookup
        ? withCardHooks(sqlite.cards, options)
        : sqlite.cards,
    close: closeDatabase,
  };
  let storeCloseObserved = false;
  const store = new CanopyStore(stores.cards, {
    ...stores,
    close: async () => {
      storeCloseObserved = true;
      await (options.onStoreClose ?? closeDatabase)();
    },
  });
  cleanups.push(async () => {
    try {
      if (!storeCloseObserved) {
        await store.close();
      }
    } finally {
      try {
        await closeDatabase();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  return { store, stores, dbPath };
}

export function createCanopySqliteTestStore(options: CanopySqliteTestOptions = {}) {
  return createCanopySqliteTestHarness(options).store;
}

export function sqliteTestAuxStores(stores: CanopySqliteTestStores) {
  const { boards, sessionsBoard, subscriptions, attachments, ready } = stores;
  return { boards, sessionsBoard, subscriptions, attachments, ready };
}
