import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentTurnPrincipal } from "./agent-turn/types.js";
import {
  commitDesktopRestartAdmission,
  hasDesktopRestartExpectedSession,
  withDesktopRestartAdmission,
} from "./desktop-restart-admission.ts";
import type { GatewayClient } from "./server-methods/types.js";
const receipt = {
  id: "receipt-a",
  sessionKey: "agent:main:task",
  expectedSessionId: "session-a",
  lifecycleGeneration: "attempt-a",
  targetBuild: "a".repeat(64),
};
const client = {
  connect: { client: { id: "branch-control-ui", mode: "ui" }, scopes: ["operator.write"] },
} as unknown as GatewayClient;
const principal = { connect: client.connect } as unknown as AgentTurnPrincipal;
const validRequest = () => ({
  sessionKey: receipt.sessionKey,
  expectedExistingSessionId: receipt.expectedSessionId,
  expectedExistingSessionLifecycleRevision: "life-a",
  idempotencyKey: "desktop-restart:receipt-a",
});
const target = {
  runId: "desktop-restart:receipt-a",
  sessionKey: receipt.sessionKey,
  sessionId: receipt.expectedSessionId,
};
test("wire-shaped fields cannot mint an exact-session capability or admission hook", () => {
  const request = {
    expectedExistingSessionId: receipt.expectedSessionId,
    idempotencyKey: target.runId,
  };
  assert.equal(hasDesktopRestartExpectedSession(request, principal), false);
  commitDesktopRestartAdmission(request, principal, target);
});
test("host capability preserves UI mode/scopes and commits only the exact canonical target", async () => {
  const request = validRequest(),
    accepted: string[] = [];
  await withDesktopRestartAdmission(
    request,
    {
      client,
      receipt,
      canonicalKey: receipt.sessionKey,
      lifecycleRevision: "life-a",
      assertCurrent: () => {},
      accept: (id) => accepted.push(id),
    },
    async () => {
      assert.equal(hasDesktopRestartExpectedSession(request, principal), true);
      assert.equal(hasDesktopRestartExpectedSession({}, principal), false);
      assert.equal(
        hasDesktopRestartExpectedSession(request, {
          ...principal,
          connect: { ...principal.connect },
        }),
        false,
      );
      for (const changed of [
        { ...target, sessionId: "other" },
        { ...target, sessionKey: "agent:main:other" },
        { ...target, runId: "other" },
      ]) {
        assert.throws(
          () => commitDesktopRestartAdmission(request, principal, changed),
          /binding mismatch/,
        );
      }
      commitDesktopRestartAdmission(request, principal, target);
    },
  );
  assert.deepEqual(accepted, [target.runId]);
  assert.equal(client.connect.client.mode, "ui");
  assert.deepEqual(client.connect.scopes, ["operator.write"]);
  assert.equal(hasDesktopRestartExpectedSession(request, principal), false);
});
test("revocation at the canonical commit prevents durable acceptance", async () => {
  const request = validRequest();
  let current = true,
    accepted = 0;
  await withDesktopRestartAdmission(
    request,
    {
      client,
      receipt,
      canonicalKey: receipt.sessionKey,
      lifecycleRevision: "life-a",
      assertCurrent: () => {
        if (!current) throw new Error("revoked");
      },
      accept: () => accepted++,
    },
    async () => {
      assert.equal(hasDesktopRestartExpectedSession(request, principal), true);
      current = false;
      assert.throws(() => commitDesktopRestartAdmission(request, principal, target), /revoked/);
    },
  );
  assert.equal(accepted, 0);
});
test("failed host dispatch retires its request capability permanently", async () => {
  const request = validRequest();
  await assert.rejects(
    withDesktopRestartAdmission(
      request,
      {
        client,
        receipt,
        canonicalKey: receipt.sessionKey,
        lifecycleRevision: "life-a",
        assertCurrent: () => {},
        accept: () => {},
      },
      async () => {
        throw new Error("failure");
      },
    ),
    /failure/,
  );
  assert.equal(hasDesktopRestartExpectedSession(request, principal), false);
});
