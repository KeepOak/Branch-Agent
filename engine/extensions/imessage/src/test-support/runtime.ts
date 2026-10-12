// Imessage plugin module implements runtime behavior.
import fs from "node:fs";
import { createPluginRuntimeMock } from "branch/plugin-sdk/channel-test-helpers";
import type {
  OpenKeyedStoreOptions,
  PluginStateSyncKeyedStore,
} from "branch/plugin-sdk/plugin-state-runtime";
import {
  closeBranchStateDatabaseForTest,
  createChannelIngressQueueForTests,
  createPluginStateKeyedStoreForTests,
  createPluginStateSyncKeyedStoreForTests,
  resetPluginStateStoreForTests,
} from "branch/plugin-sdk/plugin-state-test-runtime";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
import { resolvePreferredBranchTmpDir } from "branch/plugin-sdk/temp-path";
import { useAutoCleanupTempDirTracker } from "branch/plugin-sdk/test-env";
import { afterAll, vi } from "vitest";
import { setIMessageRuntime } from "../runtime.js";

// Vitest runs afterAll hooks in reverse order, so databases close before directory removal.
const tempDirs = useAutoCleanupTempDirTracker(afterAll);

afterAll(async () => {
  const { closeBranchAgentDatabasesAsync, closeBranchStateDatabaseAsync } =
    await import("branch/plugin-sdk/sqlite-runtime-testing");
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
});

function createIMessageTestEnv(): NodeJS.ProcessEnv & { BRANCH_STATE_DIR: string } {
  const stateDir = fs.realpathSync(
    tempDirs.make("branch-imessage-state-", resolvePreferredBranchTmpDir()),
  );
  return { ...process.env, BRANCH_STATE_DIR: stateDir };
}

let imessageTestEnv = createIMessageTestEnv();
const reusedStoreCleanups = new Map<string, () => Promise<void>>();

export function createIMessagePluginStateSyncStoreForTest<T>(
  options: OpenKeyedStoreOptions,
): PluginStateSyncKeyedStore<T> {
  return createPluginStateSyncKeyedStoreForTests<T>("imessage", {
    ...options,
    env: imessageTestEnv,
  });
}

export function installIMessageStateRuntimeForTest(): void {
  imessageTestEnv = createIMessageTestEnv();
  resetPluginStateStoreForTests({ closeDatabase: false });
  setIMessageRuntime({
    state: {
      resolveStateDir: () => imessageTestEnv.BRANCH_STATE_DIR,
      openChannelIngressQueue: (
        options?: Omit<Parameters<typeof createChannelIngressQueueForTests>[0], "channelId">,
      ) =>
        createChannelIngressQueueForTests({
          ...options,
          channelId: "imessage",
          stateDir: options?.stateDir ?? imessageTestEnv.BRANCH_STATE_DIR,
        }),
      openKeyedStore: ((options) =>
        createPluginStateKeyedStoreForTests("imessage", {
          ...options,
          env: imessageTestEnv,
        })) as PluginRuntime["state"]["openKeyedStore"],
      openSyncKeyedStore: ((options) =>
        createIMessagePluginStateSyncStoreForTest(
          options,
        )) as PluginRuntime["state"]["openSyncKeyedStore"],
    },
    channel: { inbound: { ingress: createPluginRuntimeMock().channel.inbound.ingress } },
  } as PluginRuntime);
  createIMessagePluginStateSyncStoreForTest({
    namespace: "imessage.reply-cache",
    maxEntries: 2000,
  }).entries();
  createIMessagePluginStateSyncStoreForTest({
    namespace: "imessage.reply-cache-counter",
    maxEntries: 1,
  }).entries();
}

export async function loadFreshIMessageReplyCacheForTest(options?: {
  preservePersistentState?: boolean;
  reuseDatabase?: boolean;
}): Promise<typeof import("../monitor-reply-cache.js")> {
  if (options?.reuseDatabase && !options.preservePersistentState) {
    // Clear through the real worker boundary while retaining its prepared database.
    for (const clear of reusedStoreCleanups.values()) {
      await clear();
    }
  } else if (!options?.preservePersistentState) {
    const { closeBranchStateDatabaseAsync } =
      await import("branch/plugin-sdk/sqlite-runtime-testing");
    // Drain worker-only stores before rotating the fixture state directory.
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();
    imessageTestEnv = createIMessageTestEnv();
  }
  if (!options?.preservePersistentState) {
    reusedStoreCleanups.clear();
  }
  resetPluginStateStoreForTests({ closeDatabase: !options?.reuseDatabase });
  vi.resetModules();
  const { setIMessageRuntime: setFreshIMessageRuntime } = await import("../runtime.js");
  setFreshIMessageRuntime({
    state: {
      resolveStateDir: () => imessageTestEnv.BRANCH_STATE_DIR,
      openChannelIngressQueue: (
        queueOptions?: Omit<Parameters<typeof createChannelIngressQueueForTests>[0], "channelId">,
      ) =>
        createChannelIngressQueueForTests({
          ...queueOptions,
          channelId: "imessage",
          stateDir: queueOptions?.stateDir ?? imessageTestEnv.BRANCH_STATE_DIR,
        }),
      openKeyedStore: ((storeOptions) => {
        const store = createPluginStateKeyedStoreForTests("imessage", {
          ...storeOptions,
          env: imessageTestEnv,
        });
        if (options?.reuseDatabase) {
          reusedStoreCleanups.set(storeOptions.namespace, store.clear);
        }
        return store;
      }) as PluginRuntime["state"]["openKeyedStore"],
      openSyncKeyedStore: ((storeOptions) =>
        createIMessagePluginStateSyncStoreForTest(
          storeOptions,
        )) as PluginRuntime["state"]["openSyncKeyedStore"],
    },
    channel: { inbound: { ingress: createPluginRuntimeMock().channel.inbound.ingress } },
  } as PluginRuntime);
  createIMessagePluginStateSyncStoreForTest({
    namespace: "imessage.reply-cache",
    maxEntries: 2000,
  }).entries();
  createIMessagePluginStateSyncStoreForTest({
    namespace: "imessage.reply-cache-counter",
    maxEntries: 1,
  }).entries();
  return await import("../monitor-reply-cache.js");
}

export function installIMessageFailingStateRuntimeForTest(): void {
  closeBranchStateDatabaseForTest();
  imessageTestEnv = createIMessageTestEnv();
  setIMessageRuntime({
    state: {
      resolveStateDir: () => imessageTestEnv.BRANCH_STATE_DIR,
      openChannelIngressQueue: (
        options?: Omit<Parameters<typeof createChannelIngressQueueForTests>[0], "channelId">,
      ) =>
        createChannelIngressQueueForTests({
          ...options,
          channelId: "imessage",
          stateDir: options?.stateDir ?? imessageTestEnv.BRANCH_STATE_DIR,
        }),
      openKeyedStore: (() => {
        throw new Error("test plugin-state failure");
      }) as PluginRuntime["state"]["openKeyedStore"],
      openSyncKeyedStore: (() => {
        throw new Error("test plugin-state failure");
      }) as PluginRuntime["state"]["openSyncKeyedStore"],
    },
    channel: { inbound: { ingress: createPluginRuntimeMock().channel.inbound.ingress } },
  } as PluginRuntime);
}
