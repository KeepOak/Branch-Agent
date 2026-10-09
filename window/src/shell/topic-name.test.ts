import { describe, expect, it } from "vitest";
import { distinctNames, isRawSessionKey, readableTitle, sessionKeyName, splitKeyTag } from "./topic-name";

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

describe("duplicate and prefix rules", () => {
  it("tags two threads whose readable names match, and leaves unique names alone", () => {
    const first = "agent:juniper:a2a:branch-coordinator-a5a54c";
    const second = "agent:juniper:a2a:branch-coordinator-b1c2d3";
    const names = distinctNames([{ key: first, name: sessionKeyName(first) }, { key: second, name: sessionKeyName(second) }, { key: "agent:oak:notes:a1", name: "Plan the trip" }]);
    expect(names.get(first)).toMatch(/^Talk with Coordinator · [0-9a-f]{6}$/);
    expect(names.get(second)).toMatch(/^Talk with Coordinator · [0-9a-f]{6}$/);
    expect(names.get(first)).not.toBe(names.get(second));
    expect(names.get("agent:oak:notes:a1")).toBe("Plan the trip");
  });

  it("tags repeated generic names too, so two 'Thread' rows are distinct", () => {
    const names = distinctNames([{ key: "agent:oak:notes:a5a54c", name: "Thread" }, { key: "agent:oak:notes:b1c2d3", name: "Thread" }]);
    expect(new Set(names.values()).size).toBe(2);
  });

  it("keeps a colon title with no agent or a2a prefix as typed", () => {
    expect(isRawSessionKey("Standup:2026:Q3")).toBe(false);
    expect(readableTitle("Standup:2026:Q3")).toBe("Standup:2026:Q3");
  });
});

describe("tag split", () => {
  it("splits a tagged label into its name and tag, and leaves an untagged label whole", () => {
    expect(splitKeyTag("Talk with Coordinator · ee3ee8")).toEqual({ name: "Talk with Coordinator", tag: "ee3ee8" });
    expect(splitKeyTag("Plan the trip")).toEqual({ name: "Plan the trip", tag: "" });
  });
});
