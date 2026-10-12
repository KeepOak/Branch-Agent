// microsoft/UFO@a795552d976c4c019d7c2f778a0effb5cef7de6b tests/security/test_ws_role_spoof.py,
// tests/security/test_session_id_reuse.py and tests/security/test_ws_shared_handler_isolation.py, ported to the
// Branch registry (atlas SAFETY-0182), plus the owner requests G-1604 and G-1591 (atlas SAFETY-0194).
import { describe, expect, it } from "vitest";
import { checkKeyBinding, ConnectionBindingRegistry, pickCallerDevice } from "./conversation-key-binding.js";

function registry() {
  const r = new ConnectionBindingRegistry();
  expect(r.register("conn-device", { clientId: "device-a", role: "node" })).toEqual({ ok: true });
  expect(r.register("conn-operator", { clientId: "operator-1", role: "operator" })).toEqual({ ok: true });
  return r;
}

describe("test_ws_role_spoof", () => {
  it("test_forged_constellation_role_is_rejected", () => {
    expect(registry().checkClaim("conn-device", { role: "operator" })).toEqual({ ok: false, reason: "spoofed-role" });
  });
  it("test_spoofed_client_id_is_rejected", () => {
    expect(registry().checkClaim("conn-device", { clientId: "device-b" })).toEqual({ ok: false, reason: "spoofed-client" });
  });
  it("test_legitimate_device_task_still_dispatches", () => {
    expect(registry().checkClaim("conn-device", { clientId: "device-a", role: "node" })).toEqual({ ok: true });
  });
  it("test_unregistered_connection_refuses_task", () => {
    expect(registry().checkClaim("conn-unknown", {})).toEqual({ ok: false, reason: "unregistered" });
  });
  it("test_duplicate_client_id_is_rejected", () => {
    expect(registry().register("conn-evil", { clientId: "device-a", role: "node" })).toEqual({
      ok: false,
      reason: "duplicate-client",
    });
  });
  it("test_remove_then_readd_is_allowed", () => {
    const r = registry();
    r.remove("conn-device");
    expect(r.register("conn-device-2", { clientId: "device-a", role: "node" })).toEqual({ ok: true });
  });
});

describe("test_session_id_reuse", () => {
  it("test_creator_can_reuse_their_own_session", () => {
    const r = registry();
    expect(r.claimSession("conn-operator", "s1")).toEqual({ ok: true });
    expect(r.claimSession("conn-operator", "s1")).toEqual({ ok: true });
  });
  it("test_different_client_cannot_reuse_session", () => {
    const r = registry();
    r.claimSession("conn-operator", "s1");
    expect(r.claimSession("conn-device", "s1")).toEqual({ ok: false, reason: "session-owned-by-other" });
  });
  it("test_remove_session_clears_owner_binding", () => {
    const r = registry();
    r.claimSession("conn-operator", "s1");
    r.bindResultSender("s1", "device-a");
    r.removeSession("s1");
    expect(r.sessionOwner("s1")).toBeUndefined();
    expect(r.checkResultSender("conn-device", "s1")).toEqual({ ok: false, reason: "not-executor" });
  });
  it("test_get_session_never_creates", () => {
    const r = registry();
    expect(r.sessionOwner("missing")).toBeUndefined();
    expect(r.sessionCount).toBe(0);
  });
  it("test_legitimate_owner_not_locked_out_after_squat_attempt", () => {
    const r = registry();
    r.claimSession("conn-operator", "s1");
    r.claimSession("conn-device", "s1");
    expect(r.claimSession("conn-operator", "s1")).toEqual({ ok: true });
  });
  it("test_result_sender_binding_authorizes_only_executor", () => {
    const r = registry();
    r.bindResultSender("s1", "device-a");
    expect(r.checkResultSender("conn-device", "s1")).toEqual({ ok: true });
    expect(r.checkResultSender("conn-operator", "s1")).toEqual({ ok: false, reason: "not-executor" });
  });
});

describe("conversation-bound keys and per-caller devices", () => {
  const binding = { keyId: "k1", conversationKey: "agent:main:room-a", deviceId: "laptop" };

  it("G-1604: a key bound to one conversation cannot run commands or tasks into another, through any route", () => {
    const r = new ConnectionBindingRegistry();
    r.register("conn-key", { clientId: "key-1", role: "operator", binding });
    for (const route of ["chat.send", "sessions.spawn", "tools.invoke", "exec"]) {
      expect({ route, decision: r.checkTarget("conn-key", { conversationKey: "agent:main:room-b" }) }).toEqual({
        route,
        decision: { ok: false, reason: "other-conversation" },
      });
    }
    expect(r.checkTarget("conn-key", { conversationKey: "agent:main:room-a" })).toEqual({ ok: true });
    expect(checkKeyBinding(binding, {})).toEqual({ ok: false, reason: "other-conversation" });
    expect(checkKeyBinding(binding, { conversationKey: binding.conversationKey, deviceId: "phone" })).toEqual({
      ok: false,
      reason: "other-device",
    });
  });

  it("G-1591: device picks and remote computers are chosen per caller", () => {
    const devices = [
      { deviceId: "alice-mac", ownerId: "alice", connected: true },
      { deviceId: "bob-pc", ownerId: "bob", connected: true },
    ];
    expect(pickCallerDevice({ callerId: "bob", requestedDeviceId: "alice-mac", devices })).toEqual({
      ok: false,
      reason: "other-callers-device",
    });
    expect(pickCallerDevice({ callerId: "bob", devices })).toEqual({ ok: true, deviceId: "bob-pc" });
    expect(pickCallerDevice({ callerId: "carol", devices })).toEqual({ ok: false, reason: "no-device" });
  });
});
