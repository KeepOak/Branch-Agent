import { describe, expect, it } from "vitest";
import { ScreenWatchConsent } from "./consent.js";

const link = { peerDeviceId: "peer-a", pairingGeneration: "gen-1", nowMs: 1_000 };

describe("ScreenWatchConsent", () => {
  it("starts a request pending and shows it once, even when asked again", () => {
    const consent = new ScreenWatchConsent();
    const first = consent.request(link);
    const again = consent.request({ ...link, nowMs: 2_000 });
    expect(first.state).toBe("pending");
    expect(again.id).toBe(first.id);
    expect(consent.pending().map((session) => session.id)).toEqual([first.id]);
  });

  it("activates on allow-once and binds frames to that exact peer and generation", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    const decided = consent.decide(session.id, "allow-once");
    expect(decided).toMatchObject({ state: "active", grant: "once" });
    expect(consent.isActive(session.id, "peer-a", "gen-1")).toBe(true);
    expect(consent.isActive(session.id, "peer-b", "gen-1")).toBe(false);
    expect(consent.isActive(session.id, "peer-a", "gen-2")).toBe(false);
  });

  it("ends the request on deny and never activates it", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    expect(consent.decide(session.id, "deny")).toBeUndefined();
    expect(consent.isActive(session.id, "peer-a", "gen-1")).toBe(false);
    expect(consent.decide(session.id, "allow-once")).toBeUndefined();
  });

  it("remembers allow-always for the link so the next watch starts without a prompt", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    consent.decide(session.id, "allow-always");
    consent.end(session.id);
    const next = consent.request({ ...link, nowMs: 3_000 });
    expect(next).toMatchObject({ state: "active", grant: "always" });
    expect(consent.pending()).toEqual([]);
  });

  it("asks again after re-pairing, because the pairing generation changed", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    consent.decide(session.id, "allow-always");
    consent.end(session.id);
    const repaired = consent.request({ ...link, pairingGeneration: "gen-2" });
    expect(repaired.state).toBe("pending");
  });

  it("revokePeer ends that peer's watches and forgets its always grants", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    consent.decide(session.id, "allow-always");
    consent.revokePeer("peer-a");
    expect(consent.isActive(session.id, "peer-a", "gen-1")).toBe(false);
    expect(consent.request(link).state).toBe("pending");
  });

  it("endAll ends every watch on Lockdown but keeps the remembered always grants", () => {
    const consent = new ScreenWatchConsent();
    const session = consent.request(link);
    consent.decide(session.id, "allow-always");
    consent.endAll();
    expect(consent.isActive(session.id, "peer-a", "gen-1")).toBe(false);
    expect(consent.request(link)).toMatchObject({ state: "active", grant: "always" });
  });

  it("lists pending prompts oldest first and returns copies, not live records", () => {
    const consent = new ScreenWatchConsent();
    const late = consent.request({ peerDeviceId: "peer-b", pairingGeneration: "g", nowMs: 5_000 });
    const early = consent.request({ peerDeviceId: "peer-c", pairingGeneration: "g", nowMs: 4_000 });
    const pending = consent.pending();
    expect(pending.map((session) => session.id)).toEqual([early.id, late.id]);
    pending[0]!.state = "active";
    expect(consent.isActive(early.id, "peer-c", "g")).toBe(false);
  });
});
