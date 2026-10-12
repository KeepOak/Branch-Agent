// Behaviour tests for atlas SAFETY-0118 (eliza owner binding; no upstream tests recorded) and G-1680.
import { describe, expect, it, vi } from "vitest";
import type { GatewayCaller } from "./caller-identity.js";
import { OWNER_BIND_CODE_TTL_MS, OWNER_BIND_MAX_ATTEMPTS, OwnerBindingCodes } from "./owner-binding.js";

const window: GatewayCaller = { kind: "owner-window", owner: true, local: true };

function setup() {
  const clock = { now: 0 };
  const write = vi.fn(async () => {});
  return { clock, write, codes: new OwnerBindingCodes(write, () => clock.now) };
}

describe("SAFETY-0118 owner chat-account binding", () => {
  it("G-1680: the owner names a chat account with a one-time code, and only that account is written", async () => {
    const { write, codes } = setup();
    const { code } = codes.begin({ channel: "Telegram", issuer: window });
    expect(code).toMatch(/^\d{6}$/);
    expect(await codes.verify({ channel: "telegram", externalId: "100", displayHandle: "me", code })).toEqual({ success: true });
    expect(write).toHaveBeenCalledWith({ channel: "telegram", id: "100", displayHandle: "me" });
    expect(await codes.verify({ channel: "telegram", externalId: "100", displayHandle: "me", code })).toEqual({
      success: false,
      error: "no_pending_bind",
    });
  });

  it("G-1680: nothing is named until the owner issues a code at the local window", () => {
    const { codes } = setup();
    for (const kind of ["paired-door", "remote", "local-operator", "in-process"] as const) {
      expect(() => codes.begin({ channel: "telegram", issuer: { kind, owner: true, local: true } })).toThrow();
    }
  });

  it("expires codes and invalidates them after too many attempts", async () => {
    const { clock, write, codes } = setup();
    const { code } = codes.begin({ channel: "telegram", issuer: window });
    clock.now += OWNER_BIND_CODE_TTL_MS + 1;
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code })).toEqual({
      success: false,
      error: "code_expired",
    });
    const fresh = codes.begin({ channel: "telegram", issuer: window }).code;
    const wrong = fresh === "000000" ? "111111" : "000000";
    for (let i = 1; i < OWNER_BIND_MAX_ATTEMPTS; i += 1) {
      expect((await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code: wrong })).success).toBe(false);
    }
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code: wrong })).toEqual({
      success: false,
      error: "too_many_attempts",
    });
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code: fresh })).toEqual({
      success: false,
      error: "no_pending_bind",
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("rejects malformed input and fails closed when the write fails", async () => {
    const write = vi.fn(async () => {
      throw new Error("disk full");
    });
    const codes = new OwnerBindingCodes(write, () => 0);
    const { code } = codes.begin({ channel: "telegram", issuer: window });
    expect(await codes.verify({ channel: "telegram", externalId: " ", displayHandle: "", code })).toEqual({
      success: false,
      error: "invalid_external_id",
    });
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code: "12ab" })).toEqual({
      success: false,
      error: "invalid_code_format",
    });
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code })).toEqual({
      success: false,
      error: "binding_write_failed",
    });
    expect(await codes.verify({ channel: "telegram", externalId: "1", displayHandle: "", code })).toEqual({
      success: false,
      error: "no_pending_bind",
    });
  });
});
