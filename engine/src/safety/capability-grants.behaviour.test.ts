// Behaviour tests for atlas SAFETY-0194 (G-1620 viewing grants, G-1711 phone-capability lending).
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GRANT_HEADER,
  CapabilityGrantStore,
  GRANT_IDLE_MS,
  GRANT_TTL_MS,
  OWNER_CONFIRMATION_MAX_AGE_MS,
  readCapabilityGrant,
  type GrantBinding,
} from "./capability-grants.js";

const binding: GrantBinding = {
  ownerId: "owner",
  profileId: "profile-1",
  deviceId: "tablet",
  conversationKey: "agent:main:room",
};
const phone: GrantBinding = { ownerId: "owner", profileId: "profile-1", deviceId: "phone", phoneKeyId: "pk-1", action: "camera.snap" };

function store(start = 10_000) {
  const clock = { now: start };
  return { clock, grants: new CapabilityGrantStore(() => clock.now) };
}

describe("G-1620 sensitive viewing sessions", () => {
  it("G-1620: grants are purpose-only and bound to owner, profile, conversation and device", () => {
    const { clock, grants } = store();
    const issued = grants.issue({ purpose: "screen-share", binding, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true });
    if (!issued.ok) throw new Error(issued.reason);
    const token = issued.value.token;
    expect(grants.check(token, { purpose: "screen-share", binding })).toEqual({ ok: true, value: "screen-share" });
    expect(grants.check(token, { purpose: "watch-desktop", binding })).toEqual({ ok: false, reason: "wrong-purpose" });
    for (const other of [{ profileId: "p2" }, { deviceId: "phone" }, { conversationKey: "agent:main:other" }]) {
      expect(grants.check(token, { purpose: "screen-share", binding: { ...binding, ...other } })).toEqual({
        ok: false,
        reason: "wrong-binding",
      });
    }
  });

  it("G-1620: fresh owner confirmation is required and it never unlocks the app", () => {
    const { clock, grants } = store();
    expect(grants.issue({ purpose: "watch-browser", binding, ownerConfirmedAt: clock.now, appLocked: true, localOwner: true })).toEqual({
      ok: false,
      reason: "app-locked",
    });
    expect(
      grants.issue({ purpose: "watch-browser", binding, ownerConfirmedAt: clock.now - OWNER_CONFIRMATION_MAX_AGE_MS - 1, appLocked: false, localOwner: true }),
    ).toEqual({ ok: false, reason: "stale-confirmation" });
  });

  it("G-1620: idle-out is not renewed by captured output, only by the owner; the grant also expires", () => {
    const { clock, grants } = store();
    const issued = grants.issue({ purpose: "watch-desktop", binding, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true });
    if (!issued.ok) throw new Error(issued.reason);
    clock.now += GRANT_IDLE_MS - 10;
    expect(grants.check(issued.value.token, { purpose: "watch-desktop", binding, activity: "captured-output" }).ok).toBe(true);
    clock.now += 20;
    expect(grants.check(issued.value.token, { purpose: "watch-desktop", binding })).toEqual({ ok: false, reason: "idle" });

    const again = grants.issue({ purpose: "watch-desktop", binding, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true });
    if (!again.ok) throw new Error(again.reason);
    for (let elapsed = 0; elapsed <= GRANT_TTL_MS; elapsed += GRANT_IDLE_MS / 2) {
      clock.now += GRANT_IDLE_MS / 2;
      grants.check(again.value.token, { purpose: "watch-desktop", binding, activity: "owner-input" });
    }
    expect(grants.check(again.value.token, { purpose: "watch-desktop", binding })).toEqual({ ok: false, reason: "expired" });
  });

  it("G-1620: stop, profile switch, Lockdown and lock revoke grants", () => {
    for (const reason of ["stop", "profile-switch", "lockdown", "lock"] as const) {
      const { clock, grants } = store();
      const issued = grants.issue({ purpose: "screen-share", binding, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true });
      if (!issued.ok) throw new Error(issued.reason);
      expect(grants.revokeAll(reason, reason === "profile-switch" ? "profile-1" : undefined)).toBe(1);
      expect(grants.check(issued.value.token, { purpose: "screen-share", binding })).toEqual({ ok: false, reason });
    }
  });

  it("G-1620: grants travel in headers, never URLs", () => {
    expect(readCapabilityGrant({ headers: { [CAPABILITY_GRANT_HEADER]: "abc" }, url: "/view" })).toEqual({ ok: true, token: "abc" });
    expect(readCapabilityGrant({ headers: {}, url: "/view?grant=abc" })).toEqual({ ok: false, reason: "token-in-url" });
    expect(readCapabilityGrant({ headers: { [CAPABILITY_GRANT_HEADER]: "abc" }, url: "/view?x=abc" })).toEqual({
      ok: false,
      reason: "token-in-url",
    });
  });
});

describe("G-1711 phone-capability lending", () => {
  it("G-1711: lending needs an expiring local-owner grant bound to the phone key, profile and exact action", () => {
    const { clock, grants } = store();
    expect(grants.issue({ purpose: "phone-camera", binding: phone, ownerConfirmedAt: clock.now, appLocked: false, localOwner: false })).toEqual({
      ok: false,
      reason: "not-local-owner",
    });
    expect(
      grants.issue({ purpose: "phone-camera", binding: { ...phone, phoneKeyId: undefined }, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true }),
    ).toEqual({ ok: false, reason: "missing-binding" });
    const issued = grants.issue({ purpose: "phone-camera", binding: phone, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true });
    if (!issued.ok) throw new Error(issued.reason);
    expect(grants.check(issued.value.token, { purpose: "phone-camera", binding: { ...phone, action: "camera.record" } })).toEqual({
      ok: false,
      reason: "wrong-binding",
    });
    expect(grants.check(issued.value.token, { purpose: "phone-camera", binding: phone }).ok).toBe(true);
  });

  it("G-1711: reading and acting on notifications need separate grants, phone opt-in and a single-use ticket", () => {
    const { clock, grants } = store();
    const read = { ...phone, action: "notifications.list" };
    expect(
      grants.issue({ purpose: "phone-notifications-read", binding: read, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true }),
    ).toEqual({ ok: false, reason: "phone-not-opted-in" });
    const readGrant = grants.issue({ purpose: "phone-notifications-read", binding: read, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true, phoneOptedIn: true });
    if (!readGrant.ok) throw new Error(readGrant.reason);
    const act = { ...phone, action: "notifications.reply" };
    expect(grants.check(readGrant.value.token, { purpose: "phone-notifications-act", binding: act })).toEqual({
      ok: false,
      reason: "wrong-purpose",
    });
    const ticket = grants.issue({ purpose: "phone-notifications-act", binding: act, ownerConfirmedAt: clock.now, appLocked: false, localOwner: true, phoneOptedIn: true });
    if (!ticket.ok) throw new Error(ticket.reason);
    expect(grants.check(ticket.value.token, { purpose: "phone-notifications-act", binding: act }).ok).toBe(true);
    expect(grants.check(ticket.value.token, { purpose: "phone-notifications-act", binding: act })).toEqual({ ok: false, reason: "used" });
  });
});
