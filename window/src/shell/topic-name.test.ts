import { describe, expect, it } from "vitest";
import { isRawSessionKey, readableTitle, sessionKeyName } from "./topic-name";

describe("topic names", () => {
  it("reads a cross-computer a2a key as a sentence about the other party", () => {
    expect(sessionKeyName("agent:juniper:a2a:branch-nas-linux--tester")).toBe("Talk with Tester on Nas-linux");
  });

  it("drops the random tail from a product-style peer id", () => {
    expect(sessionKeyName("agent:juniper:a2a:branch-coordinator-a5a54c")).toBe("Talk with Coordinator");
  });

  it("uses the direct peer when the key names one", () => {
    expect(sessionKeyName("agent:scout:a2a:remote:direct:peer:context")).toBe("Talk with Peer");
  });

  it("turns a non-a2a key into its last words, never the bare key", () => {
    expect(sessionKeyName("agent:oak:notes:daily-digest")).toBe("Daily digest");
    expect(sessionKeyName("agent:oak:notes:a5a54c")).toBe("Thread");
  });

  it("recognises raw keys and leaves human titles alone", () => {
    expect(isRawSessionKey("agent:juniper:a2a:branch-coordinator-a5a54c")).toBe(true);
    expect(isRawSessionKey("a2a:branch-nas-linux--tester")).toBe(true);
    expect(isRawSessionKey("Phase one p1-5.5 browser-handoff")).toBe(false);
    expect(isRawSessionKey("#785 Linux voice push-to-talk copy")).toBe(false);
    expect(isRawSessionKey("Plan the Lisbon trip")).toBe(false);
    expect(isRawSessionKey("")).toBe(false);
  });

  it("returns a human title unchanged and converts a raw key", () => {
    expect(readableTitle("Plan the Lisbon trip")).toBe("Plan the Lisbon trip");
    expect(readableTitle("agent:juniper:a2a:branch-nas-linux--tester")).toBe("Talk with Tester on Nas-linux");
  });
});
