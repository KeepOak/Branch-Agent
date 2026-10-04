import { describe, expect, it } from "vitest";
import { actionsAfter } from "./chatapps-people";

describe("chat action restrictions", () => {
  it("keeps an explicit allow list when the final known group is enabled", () => {
    const restricted = actionsAfter(undefined, ["pin", "unpin", "list-pins"], false)!;
    const restored = actionsAfter(restricted, ["pin", "unpin", "list-pins"], true);
    expect(restored).not.toBeNull();
    expect(restored).toEqual(expect.arrayContaining(restricted));
    expect(restored).toEqual(expect.arrayContaining(["pin", "unpin", "list-pins"]));
    expect(restored).toEqual([...new Set([...restricted, "pin", "unpin", "list-pins"])]);
    const withPlugin = [...restricted, "plugin-review"];
    expect(actionsAfter(withPlugin, ["pin", "unpin", "list-pins"], true)).toEqual([...withPlugin, "pin", "unpin", "list-pins"]);
  });

  it("preserves plugin action IDs and unrelated restrictions", () => {
    const allowed = ["send", "plugin-review", "pin"];
    expect(actionsAfter(allowed, ["pin", "unpin"], true)).toEqual(["send", "plugin-review", "pin", "unpin"]);
    expect(actionsAfter(allowed, ["pin", "unpin"], false)).toEqual(["send", "plugin-review"]);
    expect(allowed).toEqual(["send", "plugin-review", "pin"]);
  });

  it("keeps an explicit empty restriction and leaves inherited settings inherited", () => {
    expect(actionsAfter([], ["pin"], false)).toEqual([]);
    expect(actionsAfter([], ["pin"], true)).toEqual(["pin"]);
    expect(actionsAfter(undefined, ["pin"], true)).toBeNull();
  });
});
