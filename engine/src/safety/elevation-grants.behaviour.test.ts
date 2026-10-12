// Behaviour tests for atlas SAFETY-0165 (time-boxed elevation, eliza defaults kept).
import { describe, expect, it } from "vitest";
import { ELEVATION_DEFAULT_DURATION_SECONDS, ElevationGrants } from "./elevation-grants.js";

describe("SAFETY-0165 time-boxed elevation", () => {
  it("grants an allowlisted requester a temporary elevation that expires after eliza's 5-minute default", () => {
    let now = 1_000;
    const grants = new ElevationGrants(() => now);
    expect(grants.request({ requesterId: "kid", action: "exec", isOwner: false, allowlisted: true })).toEqual({
      granted: true,
      expiresAt: 1_000 + ELEVATION_DEFAULT_DURATION_SECONDS * 1000,
    });
    expect(grants.isElevated("kid", "exec")).toBe(true);
    expect(grants.isElevated("kid", "write")).toBe(false);
    now += ELEVATION_DEFAULT_DURATION_SECONDS * 1000 + 1;
    expect(grants.isElevated("kid", "exec")).toBe(false);
  });

  it("converts the requested duration from seconds and never grants admin-level actions by elevation", () => {
    const grants = new ElevationGrants(() => 0);
    expect(grants.request({ requesterId: "kid", action: "exec", duration: 60, isOwner: false, allowlisted: true })).toEqual({
      granted: true,
      expiresAt: 60_000,
    });
    expect(grants.request({ requesterId: "kid", action: "manage_roles", isOwner: false, allowlisted: true })).toEqual({
      granted: false,
      reason: "admin-only",
    });
    expect(grants.request({ requesterId: "stranger", action: "exec", isOwner: false, allowlisted: false })).toEqual({
      granted: false,
      reason: "not-allowlisted",
    });
  });

  it("never time-boxes the owner", () => {
    let now = 0;
    const grants = new ElevationGrants(() => now);
    expect(grants.request({ requesterId: "owner", action: "manage_settings", isOwner: true, allowlisted: false })).toEqual({
      granted: true,
      expiresAt: null,
    });
    now += 24 * 60 * 60_000;
    expect(grants.isElevated("owner", "manage_settings")).toBe(true);
    grants.revoke("owner");
    expect(grants.isElevated("owner", "manage_settings")).toBe(false);
  });
});
