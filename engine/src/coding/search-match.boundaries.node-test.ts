import assert from "node:assert/strict";
import { test } from "node:test";
import { findSearchMatch, findSearchMatches } from "./search-match.ts";

test("case folding rejects partial source-character boundaries", () => {
  for (const [source, search] of [
    ["İ", "i"],
    ["İ", "\u0307"],
    ["Aİ", "ai"],
    ["İB", "\u0307b"],
    ["𐐀", "\udc28"],
  ]) {
    assert.equal(findSearchMatch(source!, search!), null);
    assert.deepEqual(findSearchMatches(source!, search!), []);
  }
});

test("case folding skips a partial candidate and finds a complete source span", () => {
  assert.deepEqual(findSearchMatch("İ I", "i"), {
    startIndex: 2,
    endIndex: 3,
    strategyName: "caseInsensitiveMatch",
  });
  assert.deepEqual(findSearchMatch("İX \u0307X", "\u0307x"), {
    startIndex: 3,
    endIndex: 5,
    strategyName: "caseInsensitiveMatch",
  });
});

test("complete expanded folds retain original UTF-16 offsets across multiple matches", () => {
  assert.deepEqual(findSearchMatches("🌍İ!İ", "i\u0307"), [
    { startIndex: 2, endIndex: 3, strategyName: "caseInsensitiveMatch" },
    { startIndex: 4, endIndex: 5, strategyName: "caseInsensitiveMatch" },
  ]);
  assert.deepEqual(findSearchMatch("🌍𐐀!", "𐐨"), {
    startIndex: 2,
    endIndex: 4,
    strategyName: "caseInsensitiveMatch",
  });
});

test("whole-string contextual lowercasing remains authoritative", () => {
  assert.deepEqual(findSearchMatch("ΟΣ", "ος"), {
    startIndex: 0,
    endIndex: 2,
    strategyName: "caseInsensitiveMatch",
  });
});

test("exact and trimmed matches retain priority over complete folded spans", () => {
  assert.deepEqual(findSearchMatch("İ i\u0307", "i\u0307"), {
    startIndex: 2,
    endIndex: 4,
    strategyName: "exactMatch",
  });
  assert.deepEqual(findSearchMatch("İ i\u0307", " i\u0307 "), {
    startIndex: 2,
    endIndex: 4,
    strategyName: "trimmedMatch",
  });
});
