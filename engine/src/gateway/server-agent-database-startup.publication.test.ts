import { describe, expect, it } from "vitest";
import {
  bindPluginMetadataSnapshotCache,
  createPluginCache,
  PluginCacheRetiredError,
  retirePluginCache,
} from "../plugins/plugin-cache.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import { AgentDatabasePreparationSupersededError } from "../state/agent-database-admission.js";
import {
  isRetiredInventoryPublicationFailure,
  runStartupModelPublication,
  selectStartupPluginMetadataSnapshot,
} from "./server-agent-database-startup.js";

class PublicationSupersededError extends Error {}

describe("runStartupModelPublication", () => {
  it("turns a model publication superseded by a config reload into a retryable preparation supersession", async () => {
    let configRevision = 1;
    const preparedRevision = configRevision;
    const assertPreparationCurrent = () => {
      if (configRevision !== preparedRevision) {
        throw new AgentDatabasePreparationSupersededError(
          "Agent tk startup preparation was superseded",
        );
      }
    };
    const run = runStartupModelPublication(assertPreparationCurrent, async (isCurrent) => {
      configRevision += 1; // a config reload lands while the model runtime publishes
      if (!isCurrent()) {
        throw new PublicationSupersededError("prepared model runtime publication was superseded");
      }
    });
    await expect(run).rejects.toBeInstanceOf(AgentDatabasePreparationSupersededError);
  });

  it("keeps other publication failures as they are", async () => {
    const failure = new Error("model preparation failed");
    await expect(
      runStartupModelPublication(
        () => {},
        async (isCurrent) => {
          expect(isCurrent()).toBe(true);
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
  });
});

describe("startup publication after a plugin inventory retirement", () => {
  const snapshotOf = () => {
    const cache = createPluginCache();
    const snapshot = { index: { plugins: [] } } as unknown as PluginMetadataSnapshot;
    bindPluginMetadataSnapshotCache(snapshot, cache);
    return { snapshot, retire: () => void retirePluginCache(cache).catch(() => {}) };
  };
  const neverGenerationRetired = () => false;

  it("reuses the Gateway's snapshot only while its inventory is current", () => {
    const gateway = snapshotOf();
    expect(selectStartupPluginMetadataSnapshot(gateway.snapshot)).toBe(gateway.snapshot);
    gateway.retire();
    expect(selectStartupPluginMetadataSnapshot(gateway.snapshot)).toBeUndefined();
    expect(selectStartupPluginMetadataSnapshot(undefined)).toBeUndefined();
  });

  it("publishes again after a retirement, never after a superseded preparation or another failure", () => {
    const gateway = snapshotOf();
    const plain = new Error("model preparation failed");
    expect(
      isRetiredInventoryPublicationFailure(plain, gateway.snapshot, neverGenerationRetired),
    ).toBe(false);
    expect(
      isRetiredInventoryPublicationFailure(
        new PluginCacheRetiredError("Plugin inventory has retired; begin a new plugin operation."),
        undefined,
        neverGenerationRetired,
      ),
    ).toBe(true);
    expect(isRetiredInventoryPublicationFailure(plain, undefined, () => true)).toBe(true);
    gateway.retire();
    expect(
      isRetiredInventoryPublicationFailure(plain, gateway.snapshot, neverGenerationRetired),
    ).toBe(true);
    expect(
      isRetiredInventoryPublicationFailure(
        new AgentDatabasePreparationSupersededError("Agent tk startup preparation was superseded"),
        gateway.snapshot,
        () => true,
      ),
    ).toBe(false);
  });
});
