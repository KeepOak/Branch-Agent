import { describe, expect, it } from "vitest";
import { migrateContacts } from "../../../config/sessions/contacts-migration.js";
import { storeHasLegacyAgentSessionKey } from "../../../config/sessions/legacy-main-session-key-scan.js";
import {
  databasePath,
  readClaim,
  seedClaim,
  setupLegacyMainSessionMigrationTests,
} from "../../../config/sessions/legacy-main-session-migration.test-support.js";
import { contactIdForSession } from "../../../gateway/contacts/project.js";
import { openBranchAgentDatabase } from "../../../state/branch-agent-db.js";
import { openBranchStateDatabase } from "../../../state/branch-state-db.js";

describe("doctor contact migration", () => {
  const { createFixture } = setupLegacyMainSessionMigrationTests();

  it("defers malformed destination metadata without reusing its occupied session key", () => {
    const fixture = createFixture({
      agents: { entries: { ops: {} }, defaultId: "ops" },
    });
    const source = databasePath(fixture.stateDir, "main");
    const target = databasePath(fixture.stateDir, "ops");
    seedClaim({
      databaseAgentId: "main",
      databasePath: source,
      key: "agent:main:task",
      entry: { sessionId: "legacy-task", updatedAt: 10, label: "Legacy task" },
    });
    seedClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: "agent:ops:task",
      entry: { sessionId: "existing-task", updatedAt: 20, label: "Keep" },
    });
    const database = openBranchAgentDatabase({ agentId: "ops", path: target, env: fixture.env });
    database.db
      .prepare("UPDATE session_nodes SET entry_json = ? WHERE session_key = ?")
      .run("{malformed", "agent:ops:task");
    const before = database.db
      .prepare("SELECT * FROM session_nodes WHERE session_key = ?")
      .get("agent:ops:task");

    expect(migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: false })).toEqual({
      moved: 1,
      archivedEmpty: 0,
    });
    expect(migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: true })).toEqual({
      moved: 1,
      archivedEmpty: 0,
    });
    expect(
      database.db
        .prepare("SELECT * FROM session_nodes WHERE session_key = ?")
        .get("agent:ops:task"),
    ).toEqual(before);
    expect(
      readClaim({ databaseAgentId: "main", databasePath: source, key: "agent:main:task" })?.entry
        .movedToSessionKey,
    ).toMatch(/^agent:ops:legacy-/u);
  });

  it("migrates thirteen agent stores without exceeding SQLite's attachment limit", () => {
    const agentIds = Array.from({ length: 13 }, (_, index) => `worker-${index}`);
    const fixture = createFixture({
      agents: {
        entries: Object.fromEntries(["ops", ...agentIds].map((agentId) => [agentId, {}])),
        defaultId: "ops",
      },
    });
    for (const agentId of agentIds) {
      seedClaim({
        databaseAgentId: agentId,
        databasePath: databasePath(fixture.stateDir, agentId),
        key: `agent:${agentId}:brand`,
        entry: { sessionId: `${agentId}-session`, updatedAt: 10, label: "Branch" },
      });
    }
    let peakAttached = 0;
    expect(
      migrateContacts({
        cfg: fixture.cfg,
        env: fixture.env,
        apply: true,
        beforeCommit: () => {
          const db = openBranchStateDatabase({ env: fixture.env }).db;
          peakAttached = Math.max(
            peakAttached,
            db.prepare("PRAGMA database_list").all().length - 1,
          );
        },
      }),
    ).toEqual({ moved: 13, archivedEmpty: 0 });
    expect(peakAttached).toBeLessThanOrEqual(10);
    for (const agentId of agentIds) {
      expect(
        readClaim({
          databaseAgentId: agentId,
          databasePath: databasePath(fixture.stateDir, agentId),
          key: `agent:${agentId}:brand`,
        })?.entry.movedToSessionKey,
      ).toBeTruthy();
    }
  });

  it("copies legacy and brand history, archives empty window sessions, and is idempotent", () => {
    const fixture = createFixture({
      agents: { entries: { ops: {}, worker: {} }, defaultId: "ops" },
    });
    const source = databasePath(fixture.stateDir, "main");
    const worker = databasePath(fixture.stateDir, "worker");
    const target = databasePath(fixture.stateDir, "ops");
    seedClaim({
      databaseAgentId: "main",
      databasePath: source,
      key: "agent:main:task",
      entry: { sessionId: "legacy-task", updatedAt: 10, label: "Old task", pinnedAt: 9 },
      events: [{ type: "message", id: "old-message", text: "remember this" }],
    });
    seedClaim({
      databaseAgentId: "worker",
      databasePath: worker,
      key: "agent:worker:brand",
      entry: { sessionId: "brand-session", updatedAt: 20, label: "Branch" },
      events: [{ type: "message", id: "brand-message", text: "brand history" }],
    });
    seedClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: "agent:ops:empty",
      entry: { sessionId: "empty-session", updatedAt: 30, createdVia: "operator" },
      events: [],
    });
    seedClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: "agent:ops:kept",
      entry: { sessionId: "kept-session", updatedAt: 40, label: "Keep" },
    });
    const stores = [
      ["main", source],
      ["worker", worker],
      ["ops", target],
    ] as const;
    const inventory = () =>
      stores.flatMap(([agentId, path]) =>
        (
          openBranchAgentDatabase({ agentId, path, env: fixture.env })
            .db.prepare("SELECT session_key, entry_json FROM session_nodes")
            .all() as Array<{ session_key: string; entry_json: string }>
        ).map((row) => ({
          sessionKey: row.session_key,
          entry: JSON.parse(row.entry_json) as NonNullable<ReturnType<typeof readClaim>>["entry"],
        })),
      );
    const countBefore = inventory().length;

    const preview = migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: false, now: 50 });
    expect(preview).toEqual({ moved: 2, archivedEmpty: 1 });
    expect(migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: true, now: 50 })).toEqual(
      preview,
    );
    const movedLegacy = readClaim({
      databaseAgentId: "main",
      databasePath: source,
      key: "agent:main:task",
    });
    const movedBrand = readClaim({
      databaseAgentId: "worker",
      databasePath: worker,
      key: "agent:worker:brand",
    });
    expect(movedLegacy?.entry).toMatchObject({
      archiveReason: "moved",
      movedToSessionKey: "agent:ops:task",
    });
    expect(movedBrand?.entry).toMatchObject({ archiveReason: "moved" });
    expect(
      storeHasLegacyAgentSessionKey({
        legacyAgentId: "main",
        store: { databaseAgentId: "main", ownerStorePath: source, path: source },
        env: fixture.env,
      }),
    ).toBe(false);
    const legacyDestination = readClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: "agent:ops:task",
    });
    const brandDestination = readClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: movedBrand!.entry.movedToSessionKey!,
    });
    expect(legacyDestination?.events).toEqual(movedLegacy?.events);
    expect(brandDestination?.events).toEqual(movedBrand?.events);
    expect(legacyDestination?.entry).toMatchObject({ label: "Old task", pinnedAt: 9 });
    expect(
      readClaim({ databaseAgentId: "ops", databasePath: target, key: "agent:ops:empty" })?.entry,
    ).toMatchObject({ archiveReason: "empty", archivedAt: 50 });
    const after = inventory();
    const visible = after.filter((row) => !row.entry.movedToSessionKey);
    expect(visible).toHaveLength(countBefore);
    expect(new Set(visible.map((row) => row.sessionKey)).size).toBe(countBefore);
    expect(visible.map(contactIdForSession)).toEqual(Array(countBefore).fill("trunk:ops"));
    const state = openBranchStateDatabase({ env: fixture.env }).db;
    expect(
      state
        .prepare(
          "SELECT count(*) AS count FROM diagnostic_events WHERE scope='system-agent-audit' AND event_key LIKE 'contacts-migration:%'",
        )
        .get(),
    ).toMatchObject({ count: 2 });
    expect(
      state
        .prepare(
          "SELECT count(*) AS count FROM migration_sources WHERE migration_kind='contacts-migration-v1'",
        )
        .get(),
    ).toMatchObject({ count: 2 });
    expect(migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: true, now: 60 })).toEqual({
      moved: 0,
      archivedEmpty: 0,
    });
  });

  it("copies a brand conversation even when source and default Trunk share a database", () => {
    const fixture = createFixture({
      agents: { entries: { ops: {}, worker: {} }, defaultId: "ops" },
      session: { mainKey: "home" },
    });
    const shared = databasePath(fixture.stateDir, "ops");
    seedClaim({
      databaseAgentId: "ops",
      databasePath: shared,
      key: "agent:worker:brand",
      entry: {
        sessionId: "shared-brand",
        updatedAt: 10,
        label: "Branch",
        parentSessionKey: "agent:worker:main",
        contactAnchor: { threadKey: "agent:worker:main" },
      },
      events: [{ type: "message", id: "shared-message", text: "still here" }],
    });
    expect(
      migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: true, now: 20 }).moved,
    ).toBe(1);
    const source = readClaim({
      databaseAgentId: "ops",
      databasePath: shared,
      key: "agent:worker:brand",
    })!;
    const target = readClaim({
      databaseAgentId: "ops",
      databasePath: shared,
      key: source.entry.movedToSessionKey!,
    })!;
    expect(target.entry.sessionId).not.toBe(source.entry.sessionId);
    expect(target.events).toEqual(source.events);
    expect(target.entry.parentSessionKey).toBe("agent:ops:home");
    expect(target.entry.contactAnchor?.threadKey).toBe("agent:ops:home");
    expect(source.entry.archiveReason).toBe("moved");
  });

  it.each([
    { mainKey: undefined, canonical: "main" },
    { mainKey: "home", canonical: "home" },
  ])(
    "keeps empty operator-created canonical $canonical threads while archiving a topic",
    ({ mainKey, canonical }) => {
      const fixture = createFixture({
        agents: { entries: { ops: {}, worker: {} }, defaultId: "ops" },
        ...(mainKey ? { session: { mainKey } } : {}),
      });
      const opsPath = databasePath(fixture.stateDir, "ops");
      const workerPath = databasePath(fixture.stateDir, "worker");
      for (const [agentId, databasePathname] of [
        ["ops", opsPath],
        ["worker", workerPath],
      ] as const) {
        seedClaim({
          databaseAgentId: agentId,
          databasePath: databasePathname,
          key: `agent:${agentId}:${canonical}`,
          entry: { sessionId: `${agentId}-canonical`, updatedAt: 10, createdVia: "operator" },
          events: [],
        });
      }
      seedClaim({
        databaseAgentId: "ops",
        databasePath: opsPath,
        key: "agent:ops:something",
        entry: { sessionId: "empty-topic", updatedAt: 11, createdVia: "operator" },
        events: [],
      });

      expect(
        migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: false, now: 20 }),
      ).toEqual({ moved: 0, archivedEmpty: 1 });
      expect(migrateContacts({ cfg: fixture.cfg, env: fixture.env, apply: true, now: 20 })).toEqual(
        { moved: 0, archivedEmpty: 1 },
      );
      for (const [agentId, databasePathname] of [
        ["ops", opsPath],
        ["worker", workerPath],
      ] as const) {
        const entry = readClaim({
          databaseAgentId: agentId,
          databasePath: databasePathname,
          key: `agent:${agentId}:${canonical}`,
        })?.entry;
        expect(entry?.archivedAt).toBeUndefined();
        expect(entry?.archiveReason).toBeUndefined();
      }
      expect(
        readClaim({ databaseAgentId: "ops", databasePath: opsPath, key: "agent:ops:something" })
          ?.entry,
      ).toMatchObject({ archivedAt: 20, archiveReason: "empty" });
    },
  );

  it("rolls back copied rows, source markers, archives, claims and audit in one transaction", () => {
    const fixture = createFixture({ agents: { entries: { ops: {} } } });
    const source = databasePath(fixture.stateDir, "main");
    const target = databasePath(fixture.stateDir, "ops");
    seedClaim({
      databaseAgentId: "main",
      databasePath: source,
      key: "agent:main:work",
      entry: { sessionId: "legacy-work", updatedAt: 10, label: "Work" },
    });
    seedClaim({
      databaseAgentId: "ops",
      databasePath: target,
      key: "agent:ops:empty",
      entry: { sessionId: "empty-work", updatedAt: 10, createdVia: "operator" },
      events: [],
    });
    expect(() =>
      migrateContacts({
        cfg: fixture.cfg,
        env: fixture.env,
        apply: true,
        beforeCommit: () => {
          throw new Error("fault");
        },
      }),
    ).toThrow("fault");
    expect(
      readClaim({ databaseAgentId: "ops", databasePath: target, key: "agent:ops:work" }),
    ).toBeUndefined();
    expect(
      readClaim({ databaseAgentId: "main", databasePath: source, key: "agent:main:work" })?.entry
        .movedToSessionKey,
    ).toBeUndefined();
    expect(
      readClaim({ databaseAgentId: "ops", databasePath: target, key: "agent:ops:empty" })?.entry
        .archivedAt,
    ).toBeUndefined();
    const state = openBranchStateDatabase({ env: fixture.env }).db;
    expect(
      state
        .prepare(
          "SELECT count(*) AS count FROM migration_sources WHERE migration_kind='contacts-migration-v1'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      state
        .prepare(
          "SELECT count(*) AS count FROM diagnostic_events WHERE event_key LIKE 'contacts-migration:%'",
        )
        .get(),
    ).toMatchObject({ count: 0 });
  });
});
