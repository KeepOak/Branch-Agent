import { describe, expect, it } from "vitest";
import {
  readProviderResponseID,
  writeProviderResponseMetadata,
} from "./provider-response-metadata.js";

describe("provider response metadata (Kilo source cases)", () => {
  it("captures case-insensitive headers and preserves other provider metadata", () => {
    const original = { other: { request: "other-id" }, kilo: { existing: true } };
    const metadata = writeProviderResponseMetadata(original, {
      "X-Vercel-Id": "  fra1::abc-123_test  ",
    });
    expect(metadata).toEqual({
      ...original,
      kilo: { existing: true, vercelID: "fra1::abc-123_test" },
    });
    expect(readProviderResponseID(metadata)).toBe("fra1::abc-123_test");
    expect(original.kilo).toEqual({ existing: true });
  });

  it("does not add metadata for missing headers", () => {
    expect(writeProviderResponseMetadata(undefined, { server: "vercel" })).toBeUndefined();
    const original = { other: true };
    expect(writeProviderResponseMetadata(original, undefined)).toBe(original);
  });

  it.each(["fra1::<script>", "x".repeat(201), "fra1::abc\nsecret", "", "-invalid", "a/b"])(
    "rejects unsafe or oversized IDs: %s",
    (id) => {
      expect(writeProviderResponseMetadata(undefined, { "x-vercel-id": id })).toBeUndefined();
      expect(readProviderResponseID({ kilo: { vercelID: id } })).toBeUndefined();
    },
  );

  it("accepts the source maximum and revalidates stored metadata", () => {
    const id = "x".repeat(200);
    expect(
      readProviderResponseID(writeProviderResponseMetadata(undefined, { "x-vercel-id": id })),
    ).toBe(id);
    expect(readProviderResponseID({ kilo: { vercelID: "  fra1::abc  " } })).toBe("fra1::abc");
    expect(readProviderResponseID({ kilo: { vercelID: 1 } })).toBeUndefined();
    expect(readProviderResponseID({ kilo: [] })).toBeUndefined();
  });
});
