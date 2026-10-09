// Settings › Branch account gateway methods: who may start a Google sign-in, and what status reports.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { accountHandlers } from "./account.js";
import type { GatewayClient } from "./client-types.js";
import type { GatewayRequestContext, RespondFn } from "./types.js";

let stateDir: string;
beforeEach(async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "account-methods-"));
  vi.stubEnv("BRANCH_STATE_DIR", stateDir);
  vi.stubEnv("BRANCH_GOOGLE_OAUTH_CLIENT_ID", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(stateDir, { recursive: true, force: true });
});

function client(params: { admin: boolean; local: boolean }): GatewayClient {
  return {
    connect: { scopes: params.admin ? ["operator.admin"] : ["operator.read"] },
    ...(params.local ? { internal: { isLocalClient: true } } : {}),
  } as unknown as GatewayClient;
}

async function call(
  method: string,
  params: Record<string, unknown>,
  who: GatewayClient | null = null,
) {
  const handler = accountHandlers[method];
  if (!handler) {
    throw new Error(`Missing ${method} handler`);
  }
  const respond = vi.fn<RespondFn>();
  await handler({
    req: { type: "req", id: method, method },
    params,
    context: {} as GatewayRequestContext,
    client: who,
    isWebchatConnect: () => false,
    respond,
  });
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return {
    ok,
    payload: payload as Record<string, unknown>,
    error: error as { message?: string } | undefined,
  };
}

describe("Branch account gateway methods", () => {
  it("reads with operator.read and changes the account only with operator.admin", () => {
    expect(authorizeOperatorScopesForMethod("account.status", ["operator.read"]).allowed).toBe(
      true,
    );
    expect(
      authorizeOperatorScopesForMethod("account.google.signIn", ["operator.write"]).allowed,
    ).toBe(false);
    expect(authorizeOperatorScopesForMethod("account.signOut", ["operator.write"]).allowed).toBe(
      false,
    );
    expect(authorizeOperatorScopesForMethod("account.signOut", ["operator.admin"]).allowed).toBe(
      true,
    );
  });

  it("reports a signed-out device whose build has no Google client yet", async () => {
    const status = await call("account.status", {});
    expect(status.ok).toBe(true);
    expect(status.payload.google).toMatchObject({
      available: false,
      reason: "Google sign-in isn't set up for this build of Branch yet.",
      signedIn: false,
    });
  });

  it("starts a sign-in only for an administrator on this computer, and only when the build can sign in", async () => {
    const params = { sessionId: "s-1" };
    expect(
      (await call("account.google.signIn", params, client({ admin: false, local: true }))).error
        ?.message,
    ).toBe("Signing in to Branch requires an administrator connection.");
    expect(
      (await call("account.google.signIn", params, client({ admin: true, local: false }))).error
        ?.message,
    ).toBe("Sign in from Branch on the computer this Gateway runs on.");
    expect(
      (await call("account.google.signIn", params, client({ admin: true, local: true }))).error
        ?.message,
    ).toBe("Google sign-in isn't set up for this build of Branch yet.");
    expect((await call("account.google.signIn", {}, client({ admin: true, local: true }))).ok).toBe(
      false,
    );
  });
});
