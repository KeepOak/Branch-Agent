import type {
  PersistedCanopyAttachment,
  PersistedCanopyBoard,
  CanopyCardStore,
  CanopyKeyedStore,
  CanopySessionsBoardStore,
  CanopySubscriptionStore,
} from "./persistence-types.js";
import type { CanopySqliteResult } from "./sqlite-store-errors.js";

type Operation<Method extends (...args: never[]) => unknown> = {
  input: { connection: number; args: Parameters<Method> };
  output: Awaited<ReturnType<Method>>;
};

type StoreMethods<Prefix extends string, Store> = {
  [Key in keyof Store & string as `${Prefix}.${Key}`]: Store[Key];
};

type CanopySqliteStoreMethods = StoreMethods<"cards", CanopyCardStore> &
  StoreMethods<"boards", CanopyKeyedStore<PersistedCanopyBoard>> &
  StoreMethods<"sessionsBoard", CanopySessionsBoardStore> &
  StoreMethods<"subscriptions", CanopySubscriptionStore> &
  StoreMethods<"attachments", CanopyKeyedStore<PersistedCanopyAttachment>>;

type CanopySqliteStoreOperations = {
  [Key in keyof CanopySqliteStoreMethods]: Operation<CanopySqliteStoreMethods[Key]>;
};

export type CanopySqliteOperations = {
  "connection.open": { input: undefined; output: { connection: number; dataVersion: number } };
  "connection.close": { input: { connection: number }; output: void };
  dataVersion: { input: { connection: number }; output: number };
} & CanopySqliteStoreOperations;
export type CanopySqliteWorkerOperations = {
  [K in keyof CanopySqliteOperations]: {
    input: CanopySqliteOperations[K]["input"];
    output: CanopySqliteResult<CanopySqliteOperations[K]["output"]>;
  };
};
