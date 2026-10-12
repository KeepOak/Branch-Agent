// AstrBotDevs/AstrBot@9d4f523464644554e0e8e50fa2a65f146e320cd1:tests/test_api_key_open_api.py (atlas SAFETY-0099)
// The HTTP routes are not ported; the scope, revoke and validation assertions run
// against the key service functions. Owner requests R-1245, G-1473, G-1551, G-1612.
import { describe, expect, it } from "vitest";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
} from "../gateway/operator-scopes.js";
import {
  SCOPED_API_KEY_PREFIX,
  ScopedApiKeyError,
  describeScopedApiKey,
  mintScopedApiKey,
  revokeScopedApiKey,
  revokeScopedApiKeysForSubject,
  scopedApiKeyDigest,
  verifyScopedApiKey,
  type ScopedApiKeyPolicy,
} from "./scoped-api-key.js";

const DEFAULT_OPEN_API_SCOPES = [
  "bot",
  "provider",
  "persona",
  "im",
  "config",
  "chat",
  "data",
  "file",
  "plugin",
  "mcp",
  "skill",
];

// AstrBot auth_service.py scope tables at the pinned commit.
const ASTRBOT_POLICY: ScopedApiKeyPolicy = {
  allowed: [...DEFAULT_OPEN_API_SCOPES, "chat:admin", "config:edit_admin"],
  defaults: DEFAULT_OPEN_API_SCOPES,
  includes: { config: ["bot", "provider"] },
  requires: { "config:edit_admin": "config", "chat:admin": "chat" },
};

// Device and agent keys may narrow operator access but never carry the primary admin scope.
const DEVICE_POLICY: ScopedApiKeyPolicy = {
  allowed: [READ_SCOPE, WRITE_SCOPE, APPROVALS_SCOPE, PAIRING_SCOPE],
};

function createKey(scopes: unknown, name = "test-key") {
  return mintScopedApiKey({ subject: "dashboard", name, scopes, policy: ASTRBOT_POLICY });
}

function createKeyError(scopes: unknown): string {
  try {
    createKey(scopes);
  } catch (error) {
    expect(error).toBeInstanceOf(ScopedApiKeyError);
    return (error as Error).message;
  }
  throw new Error("expected key creation to fail");
}

describe("scoped API keys", () => {
  it("test_api_key_scope_and_revoke", () => {
    const { rawKey, record } = createKey(["im"], "im-scope-key");
    let records = [record];

    expect(verifyScopedApiKey({ rawKey, records, requiredScope: "im" }).ok).toBe(true);
    expect(verifyScopedApiKey({ rawKey, records, requiredScope: "chat" })).toEqual({
      ok: false,
      status: 403,
      reason: "scope",
      missingScope: "chat",
    });
    expect(verifyScopedApiKey({ rawKey, records, requiredScope: "config" })).toMatchObject({
      status: 403,
    });
    expect(verifyScopedApiKey({ rawKey, records, requiredScope: "file" })).toMatchObject({
      status: 403,
    });

    records = records.map((entry) => revokeScopedApiKey(entry));
    expect(verifyScopedApiKey({ rawKey, records, requiredScope: "im" })).toEqual({
      ok: false,
      status: 401,
      reason: "invalid",
    });
  });

  it("test_open_api_auth_validation_and_key_carriers", () => {
    const { record } = createKey(["im"], "auth-carrier-key");
    const invalid = { ok: false, status: 401, reason: "invalid" };
    expect(verifyScopedApiKey({ rawKey: undefined, records: [record] })).toEqual(invalid);
    expect(
      verifyScopedApiKey({ rawKey: SCOPED_API_KEY_PREFIX + "invalid", records: [record] }),
    ).toEqual(invalid);
  });

  it("test_open_api_key_scope_normalization", () => {
    expect(new Set(createKey(["config"]).record.scopes)).toEqual(
      new Set(["config", "bot", "provider"]),
    );
    expect(new Set(createKey(["mcp", "skill"]).record.scopes)).toEqual(new Set(["mcp", "skill"]));
    expect(new Set(createKey(["config", "config:edit_admin"]).record.scopes)).toEqual(
      new Set(["config", "config:edit_admin", "bot", "provider"]),
    );
    expect(createKeyError(["config:edit_admin"])).toBe(
      "config:edit_admin requires the config scope",
    );
    expect(new Set(createKey(["chat", "chat:admin"]).record.scopes)).toEqual(
      new Set(["chat", "chat:admin"]),
    );
    expect(createKeyError(["chat:admin"])).toBe("chat:admin requires the chat scope");
  });

  it("rejects unknown, malformed and empty scope requests", () => {
    expect(createKeyError(["im", "root"])).toBe("Invalid scopes: root");
    expect(createKeyError("im")).toBe("Invalid scopes");
    expect(createKeyError([])).toBe("At least one valid scope is required");
    expect(new Set(createKey(undefined).record.scopes)).toEqual(new Set(DEFAULT_OPEN_API_SCOPES));
  });

  it("stores only a SHA-256 digest and shows the raw key once", () => {
    const { rawKey, record } = createKey(["im"]);
    expect(rawKey.startsWith(SCOPED_API_KEY_PREFIX)).toBe(true);
    expect(record.digest).toBe(scopedApiKeyDigest(rawKey));
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(record)).not.toContain(rawKey);
    const view = describeScopedApiKey(record);
    expect(view).not.toHaveProperty("digest");
    expect(JSON.stringify(view)).not.toContain(rawKey);
    expect(view.keyPrefix).toBe(rawKey.slice(0, 12));
  });
});

describe("owner requests", () => {
  it("R-1245: short-lived scoped keys for the SDK, widget and extension expire", () => {
    const nowMs = 1_000_000;
    const { rawKey, record } = mintScopedApiKey({
      subject: "widget",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
      expiresInMs: 15 * 60_000,
      nowMs,
    });
    const records = [record];
    expect(verifyScopedApiKey({ rawKey, records, nowMs: nowMs + 60_000 }).ok).toBe(true);
    expect(verifyScopedApiKey({ rawKey, records, nowMs: nowMs + 15 * 60_000 })).toMatchObject({
      status: 401,
    });
    expect(describeScopedApiKey(record, nowMs + 15 * 60_000).isExpired).toBe(true);
  });

  it("G-1473: a surrogate key only reaches the scopes it was minted with", () => {
    const { rawKey, record } = mintScopedApiKey({
      subject: "extension",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
      expiresInMs: 60_000,
    });
    expect(verifyScopedApiKey({ rawKey, records: [record], requiredScope: READ_SCOPE }).ok).toBe(
      true,
    );
    expect(
      verifyScopedApiKey({ rawKey, records: [record], requiredScope: WRITE_SCOPE }),
    ).toMatchObject({ status: 403, missingScope: WRITE_SCOPE });
  });

  it("G-1551: temporary auth tokens are generated with a bounded lifetime", () => {
    const first = mintScopedApiKey({
      subject: "sdk",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
      expiresInMs: 5_000,
      nowMs: 10,
    });
    const second = mintScopedApiKey({
      subject: "sdk",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
      expiresInMs: 5_000,
      nowMs: 10,
    });
    expect(first.rawKey).not.toBe(second.rawKey);
    expect(first.record.expiresAtMs).toBe(5_010);
    expect(() =>
      mintScopedApiKey({
        subject: "sdk",
        policy: DEVICE_POLICY,
        scopes: [READ_SCOPE],
        expiresInMs: 0,
      }),
    ).toThrow("expiresInMs must be a positive integer");
  });

  it("G-1612: removing a device revokes its keys everywhere and never hands out the primary key", () => {
    const phone = mintScopedApiKey({
      subject: "device:phone",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
    });
    const phoneWrite = mintScopedApiKey({
      subject: "device:phone",
      scopes: [WRITE_SCOPE],
      policy: DEVICE_POLICY,
    });
    const laptop = mintScopedApiKey({
      subject: "device:laptop",
      scopes: [READ_SCOPE],
      policy: DEVICE_POLICY,
    });
    const records = revokeScopedApiKeysForSubject(
      [phone.record, phoneWrite.record, laptop.record],
      "device:phone",
    );
    expect(verifyScopedApiKey({ rawKey: phone.rawKey, records }).ok).toBe(false);
    expect(verifyScopedApiKey({ rawKey: phoneWrite.rawKey, records }).ok).toBe(false);
    expect(verifyScopedApiKey({ rawKey: laptop.rawKey, records }).ok).toBe(true);
    expect(() =>
      mintScopedApiKey({ subject: "device:phone", scopes: [ADMIN_SCOPE], policy: DEVICE_POLICY }),
    ).toThrow("Invalid scopes: " + ADMIN_SCOPE);
  });
});
