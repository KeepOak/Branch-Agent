// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/gateway/openresponses-session-store.test.ts (atlas INTEGRATIONS-0148). Changed for Branch: keep newer authority and Incognito assertions and restore pinned capacity eviction coverage.
import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as workerAdmission from "../infra/sqlite-worker-operation-admission.js";
import { createCorePluginStateKeyedStore } from "../plugin-state/plugin-state-store.js";
import { seedPluginStateEntriesForTests } from "../plugin-state/plugin-state-store.test-helpers.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { lookupResponseSession, rememberResponseSession } from "./openresponses-session-store.js";
import {
  MAX_RESPONSE_SESSION_ENTRIES,
  RESPONSE_SESSION_RETENTION_MS,
  type ResponseSessionScope,
} from "./openresponses-session-store.types.js";

const scope = {
  authSubject: "synthetic-subject",
  agentId: "main",
  requestedSessionKey: "explicit-session",
};
const storeOptions = {
  ownerId: "core:openresponses",
  namespace: "response-sessions",
  maxEntries: MAX_RESPONSE_SESSION_ENTRIES,
  defaultTtlMs: RESPONSE_SESSION_RETENTION_MS,
} as const;
const current = () => {};

afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchStateDatabaseAsync();
});

it("keeps reads and Incognito noncreating, and scoped continuity survives reopen until expiry", async () => {
  await withBranchTestState({ label: "openresponses-reopen" }, async ({ env }) => {
    const input = { ...scope, responseId: "resp_reopen" };
    expect(await lookupResponseSession(input, env)).toBeUndefined();
    for (const privateKeys of [
      { sessionKey: "agent:main:dashboard:incognito-private" },
      { sessionKey: "dashboard:incognito-private" },
      { sessionKey: "ordinary", requestedSessionKey: "agent:main:dashboard:incognito-private" },
      { sessionKey: "ordinary", requestedSessionKey: "dashboard:incognito-private" },
    ]) {
      await rememberResponseSession({ ...input, ...privateKeys }, current, env);
    }
    expect(existsSync(resolveBranchStateSqlitePath(env))).toBe(false);

    const sessionKey = "agent:main:openresponses:retained";
    await rememberResponseSession({ ...input, sessionKey }, current, env);
    await closeBranchStateDatabaseAsync();
    expect(await lookupResponseSession(input, env)).toBe(sessionKey);
    for (const mismatch of [
      { responseId: "unknown" },
      { authSubject: "other-subject" },
      { agentId: "other-agent" },
      { requestedSessionKey: "other-session" },
      { requestedSessionKey: undefined },
    ]) {
      expect(await lookupResponseSession({ ...input, ...mismatch }, env)).toBeUndefined();
    }
    const store = createCorePluginStateKeyedStore<ResponseSessionScope & { sessionKey: string }>({
      ...storeOptions,
      env,
    });
    const [entry] = await store.entries();
    expect(entry).toMatchObject({ key: input.responseId, value: { ...scope, sessionKey } });
    expect(entry!.expiresAt).toBe(entry!.createdAt + RESPONSE_SESSION_RETENTION_MS);
    const expiredAt = Date.now() - 1;
    seedPluginStateEntriesForTests([
      {
        pluginId: storeOptions.ownerId,
        namespace: storeOptions.namespace,
        key: input.responseId,
        value: entry!.value,
        createdAt: expiredAt - RESPONSE_SESSION_RETENTION_MS,
        expiresAt: expiredAt,
      },
    ]);
    await closeBranchStateDatabaseAsync();
    expect(await lookupResponseSession(input, env)).toBeUndefined();
  });
});

it("rolls back when caller authority expires before commit", async () => {
  await withBranchTestState({ label: "openresponses-authority" }, async ({ env }) => {
    const createAdmission = workerAdmission.createSqliteWorkerOperationAdmission;
    let authorized = true;
    vi.spyOn(workerAdmission, "createSqliteWorkerOperationAdmission").mockImplementation(
      (admit, attachment) =>
        createAdmission((request, grant) => {
          if (request.stage === "commit") {
            authorized = false;
          }
          admit(request, grant);
        }, attachment),
    );
    const input = { ...scope, responseId: "resp_revoked" };
    await expect(
      rememberResponseSession(
        { ...input, sessionKey: "revoked-session" },
        () => {
          if (!authorized) {
            throw new Error("synthetic requester revoked");
          }
        },
        env,
      ),
    ).rejects.toThrow(/plugin state/);
    expect(authorized).toBe(false);
    expect(await lookupResponseSession(input, env)).toBeUndefined();
  });
});

describe("Harvest pinned regression coverage", () => {
  it("uses keyed-store eviction to retain the newest 5000 response mappings", async () => {
    await withBranchTestState({ label: "openresponses-capacity" }, async ({ env }) => {
      const now = Date.now();
      seedPluginStateEntriesForTests(
        Array.from({ length: MAX_RESPONSE_SESSION_ENTRIES }, (_, index) => ({
          pluginId: storeOptions.ownerId,
          namespace: storeOptions.namespace,
          key: `resp_capacity_${index}`,
          value: { ...scope, sessionKey: `session_${index}` },
          createdAt: now - MAX_RESPONSE_SESSION_ENTRIES + index,
          expiresAt: now + RESPONSE_SESSION_RETENTION_MS,
        })),
      );
      await rememberResponseSession(
        { ...scope, responseId: "resp_newest", sessionKey: "newest-session" },
        current,
        env,
      );
      const lookup = (responseId: string) => lookupResponseSession({ ...scope, responseId }, env);
      expect(await lookup("resp_capacity_0")).toBeUndefined();
      expect(await lookup("resp_capacity_1")).toBe("session_1");
      expect(await lookup("resp_newest")).toBe("newest-session");
      expect(await createCorePluginStateKeyedStore({ ...storeOptions, env }).count()).toBe(
        MAX_RESPONSE_SESSION_ENTRIES,
      );
    });
  });
});
