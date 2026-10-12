import { afterEach, expect, test } from "vitest";
import { loadSessionEntry } from "../config/sessions/session-accessor.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { disposeSessionReadContexts } from "./server-methods/sessions-read-cache.test-support.js";
import { directSessionReq, setupGatewaySessionsHandlerTestHarness } from "./test/server-sessions.test-helpers.js";

const { createSessionStoreDir } = setupGatewaySessionsHandlerTestHarness();
afterEach(async () => {
  await disposeSessionReadContexts();
  closeBranchStateDatabaseForTest();
});

test("an anchored topic is created with its first message and stores its origin once", async () => {
  const { storePath } = await createSessionStoreDir();
  const threadKey = "agent:main:main";
  const parent = await directSessionReq("sessions.create", { key: threadKey, agentId: "main" });
  expect(parent.ok, JSON.stringify(parent.error)).toBe(true);
  const anchor = { threadKey, afterMessageId: "entry-1" };
  const empty = await directSessionReq("sessions.create", { agentId: "main", parentSessionKey: threadKey, contactAnchor: anchor });
  expect(empty.ok).toBe(false);
  const created = await directSessionReq<{ key: string }>("sessions.create", {
    agentId: "main", parentSessionKey: threadKey, contactAnchor: anchor, message: "Follow up here",
  });
  expect(created.ok, JSON.stringify(created.error)).toBe(true);
  expect(loadSessionEntry({ agentId: "main", sessionKey: created.payload!.key, storePath })?.contactAnchor).toEqual(anchor);
});
