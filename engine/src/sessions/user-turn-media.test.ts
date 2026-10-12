import { describe, expect, it } from "vitest";
import { hasPersistedMedia } from "./user-turn-media.js";

describe("hasPersistedMedia", () => {
  it.each([
    ["facts-only", { __branch: { media: [{ path: "/media/fact.png" }] } }],
    ["sparse", { __branch: { media: [{}, { path: "/media/sparse.png" }] } }],
    ["type-only", { __branch: { media: [{ contentType: "image/png" }] } }],
    ["media-only", { role: "user", content: "", __branch: { media: [{ kind: "image" }] } }],
  ])("recognizes $0 persisted rows", (_name, message) => {
    expect(hasPersistedMedia(message)).toBe(true);
  });

  it("rejects empty and alignment-only rows", () => {
    expect(hasPersistedMedia({ MediaPath: "/media/legacy.png" })).toBe(false);
    expect(hasPersistedMedia({ role: "user", content: "" })).toBe(false);
    expect(hasPersistedMedia({ __branch: { media: [{}] } })).toBe(false);
  });
});
