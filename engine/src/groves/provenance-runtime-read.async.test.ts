import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroveInstallSchemaVersionRow } from "./provenance-runtime-read.kernel.js";

const worker = vi.hoisted(() => ({
  read: vi.fn<() => Promise<GroveInstallSchemaVersionRow[] | undefined>>(),
  assertCurrent: vi.fn<() => void>(),
}));

vi.mock("../state/branch-state-worker-store.js", () => ({
  runBranchStateWorkerOperation: worker.read,
}));
vi.mock("../state/branch-state-worker-context.js", () => ({
  captureBranchStateWorkerContext: () => ({
    admission: { assertCurrent: worker.assertCurrent },
  }),
}));
vi.mock("../state/branch-state-db-readonly.js", () => ({
  withExistingBranchStateDatabaseArtifactPreservingReadOnly: () => {
    throw new Error("Consent preparation must not read SQLite on the main thread");
  },
}));

import {
  cacheGroveInstallSchemaVersion,
  captureGroveInstallSchemaVersionFacts,
  deleteCachedGroveInstallSchemaVersion,
  initializeCachedGroveInstallSchemaVersions,
  prepareGroveInstallSchemaVersions,
  readCachedGroveInstallSchemaVersions,
  withGroveInstallSchemaVersionFacts,
} from "./provenance-runtime-read.js";
import { GROVE_INSTALL_RECORD_SCHEMA_VERSION } from "./provenance-schema-version.js";

let pathSequence = 0;
let options: { path: string };
const row = {
  agentId: "worker",
  schemaVersion: GROVE_INSTALL_RECORD_SCHEMA_VERSION,
  agentConfigDigest: "original",
};

function schemaVersions(agentConfigDigest: string) {
  return new Map([["worker", { kind: "ok", schemaVersion: row.schemaVersion, agentConfigDigest }]]);
}

beforeEach(() => {
  options = { path: `/grove-consent-preparation-${++pathSequence}.sqlite` };
  worker.assertCurrent.mockReset();
  worker.read.mockReset().mockResolvedValue([row]);
});

describe("asynchronous Grove consent preparation", () => {
  it("hands off one task's facts without replacing newer host facts or retaining the scope", async () => {
    (await prepareGroveInstallSchemaVersions(options)).publish();
    const facts = structuredClone(captureGroveInstallSchemaVersionFacts(options));
    cacheGroveInstallSchemaVersion("worker", row.schemaVersion, "newer", options);
    const current = readCachedGroveInstallSchemaVersions(options);
    worker.read.mockClear();
    let readAfterScope = () => readCachedGroveInstallSchemaVersions(options);
    await withGroveInstallSchemaVersionFacts(facts, async () => {
      const captured = AsyncLocalStorage.snapshot();
      readAfterScope = () => captured(() => readCachedGroveInstallSchemaVersions(options));
      for (let tick = 0; tick < 5; tick++) {
        initializeCachedGroveInstallSchemaVersions(options);
        expect(readCachedGroveInstallSchemaVersions(options)).toEqual({
          kind: "ready",
          schemaVersions: schemaVersions("original"),
        });
        await Promise.resolve();
      }
      expect(() =>
        initializeCachedGroveInstallSchemaVersions({ path: `${options.path}-other` }),
      ).toThrow("outside their captured state scope");
    });
    expect(readAfterScope).toThrow("outside their captured state scope");
    expect(readCachedGroveInstallSchemaVersions(options)).toBe(current);
    expect(worker.read).not.toHaveBeenCalled();
    await withGroveInstallSchemaVersionFacts(
      structuredClone(captureGroveInstallSchemaVersionFacts(options)),
      async () => expect(readCachedGroveInstallSchemaVersions(options)).toEqual(current),
    );
  });

  it.each(["uninitialized", "state-error", "invalid-row"] as const)(
    "preserves %s through the worker handoff without rediscovering ownership",
    async (state) => {
      if (state === "state-error") {
        (await prepareGroveInstallSchemaVersions(options)).publish();
        worker.read.mockRejectedValueOnce(new Error("Unreadable provenance"));
        (await prepareGroveInstallSchemaVersions(options)).publish();
      } else if (state === "invalid-row") {
        worker.read.mockResolvedValueOnce([{ ...row, schemaVersion: "unsupported" }]);
        (await prepareGroveInstallSchemaVersions(options)).publish();
      }
      const facts = structuredClone(captureGroveInstallSchemaVersionFacts(options));
      worker.read.mockClear();
      await withGroveInstallSchemaVersionFacts(facts, async () => {
        initializeCachedGroveInstallSchemaVersions(options);
        const snapshot = readCachedGroveInstallSchemaVersions(options);
        if (state === "invalid-row") {
          expect(snapshot.kind).toBe("ready");
          if (snapshot.kind === "ready") {
            expect(snapshot.schemaVersions.get("worker")).toMatchObject({ kind: "error" });
          }
        } else {
          expect(snapshot).toMatchObject(
            state === "uninitialized"
              ? { kind: "uninitialized" }
              : {
                  kind: "state-error",
                  error: "Unreadable provenance",
                  knownAgentIds: new Set(["worker"]),
                },
          );
        }
      });
      expect(worker.read).not.toHaveBeenCalled();
    },
  );

  it("keeps worker rows private until publication without synchronous SQLite reads", async () => {
    const prepared = await prepareGroveInstallSchemaVersions(options);
    expect(readCachedGroveInstallSchemaVersions(options)).toEqual({ kind: "uninitialized" });

    prepared.publish();

    expect(readCachedGroveInstallSchemaVersions(options)).toEqual({
      kind: "ready",
      schemaVersions: schemaVersions("original"),
    });
  });

  it.each(["update", "delete"] as const)(
    "keeps a newer committed %s when an older read publishes",
    async (mutation) => {
      (await prepareGroveInstallSchemaVersions(options)).publish();
      if (mutation === "update") {
        worker.read.mockRejectedValueOnce(new Error("Read failed"));
      }
      const stale = await prepareGroveInstallSchemaVersions(options);
      if (mutation === "update") {
        cacheGroveInstallSchemaVersion("worker", row.schemaVersion, "newer", options);
      } else {
        deleteCachedGroveInstallSchemaVersion("worker", options);
      }
      const current = readCachedGroveInstallSchemaVersions(options);

      stale.publish();

      expect(readCachedGroveInstallSchemaVersions(options)).toBe(current);
      expect(current).toEqual({
        kind: "ready",
        schemaVersions: mutation === "update" ? schemaVersions("newer") : new Map(),
      });
    },
  );

  it("fails closed if database admission expires before publication", async () => {
    (await prepareGroveInstallSchemaVersions(options)).publish();
    const prepared = await prepareGroveInstallSchemaVersions(options);
    const error = new Error("Database admission expired");
    worker.assertCurrent.mockImplementation(() => {
      throw error;
    });

    prepared.publish();

    expect(readCachedGroveInstallSchemaVersions(options)).toEqual({
      kind: "state-error",
      error,
      knownAgentIds: new Set(["worker"]),
      ownershipUnknown: true,
    });
  });
});
