import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPullReviewMetadata, parseReviewers, pullMergeMetadata } from "./detail-reviews.ts";

// Ported cases from pinned kilocode am-pr-utils.test.ts, parseReviewers suite.
const cases = [
  { name: "empty requests and reviews", requests: [], reviews: [], expected: [] },
  {
    name: "pending reviewer request",
    requests: [{ requestedReviewer: { login: "alice" } }],
    reviews: [],
    expected: [{ login: "alice", state: "pending" }],
  },
  {
    name: "request without login",
    requests: [{ requestedReviewer: {} }],
    reviews: [],
    expected: [],
  },
  {
    name: "approval without request",
    requests: [],
    reviews: [{ author: { login: "bob" }, state: "APPROVED" }],
    expected: [{ login: "bob", state: "approved" }],
  },
  {
    name: "approval replaces pending request",
    requests: [{ requestedReviewer: { login: "alice" } }],
    reviews: [{ author: { login: "alice" }, state: "APPROVED" }],
    expected: [{ login: "alice", state: "approved" }],
  },
  {
    name: "comment does not replace approval",
    requests: [{ requestedReviewer: { login: "alice" } }],
    reviews: [
      { author: { login: "alice" }, state: "APPROVED" },
      { author: { login: "alice" }, state: "COMMENTED" },
    ],
    expected: [{ login: "alice", state: "approved" }],
  },
  {
    name: "changes requested replaces pending",
    requests: [{ requestedReviewer: { login: "alice" } }],
    reviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
    expected: [{ login: "alice", state: "changes_requested" }],
  },
  {
    name: "review without login",
    requests: [],
    reviews: [{ author: {}, state: "APPROVED" }],
    expected: [],
  },
];
for (const example of cases) {
  test(example.name, () =>
    assert.deepEqual(parseReviewers(example.requests, example.reviews), example.expected),
  );
}
test("dismissed and pending reviews do not create verdicts", () => {
  assert.deepEqual(
    parseReviewers(
      [],
      [
        { author: { login: "alice" }, state: "DISMISSED" },
        { author: { login: "bob" }, state: "PENDING" },
      ],
    ),
    [],
  );
});
test("unknown review states cannot resolve inherited object properties", () => {
  assert.deepEqual(
    parseReviewers(
      [],
      [
        { author: { login: "alice" }, state: "toString" },
        { author: { login: "bob" }, state: "__proto__" },
      ],
    ),
    [],
  );
});
test("REST pagination replaces an earlier approval with later changes requested", async () => {
  const requests: string[] = [];
  const metadata = await fetchPullReviewMetadata(
    "https://api.github.com/repos/o/r/pulls/7",
    [{ login: "carol" }],
    async (url) => {
      requests.push(url);
      return requests.length === 1
        ? { value: [{ user: { login: "alice" }, state: "APPROVED" }], hasNextPage: true }
        : { value: [{ user: { login: "alice" }, state: "CHANGES_REQUESTED" }], hasNextPage: false };
    },
  );
  assert.deepEqual(metadata, [
    { label: "Review", value: "@carol · Requested" },
    { label: "Review", value: "@alice · Changes requested" },
  ]);
  assert.deepEqual(
    requests.map((url) => new URL(url).searchParams.get("page")),
    ["1", "2"],
  );
});
test("a failed later review page returns no stale successful result", async () => {
  let page = 0;
  await assert.rejects(
    fetchPullReviewMetadata("https://api.github.com/repos/o/r/pulls/7", [], async () => {
      if (++page === 1)
        return { value: [{ user: { login: "alice" }, state: "APPROVED" }], hasNextPage: true };
      throw new Error("fixture second page unavailable");
    }),
  );
});
test("invalid review response rejects", async () => {
  await assert.rejects(
    fetchPullReviewMetadata("https://api.github.com/repos/o/r/pulls/7", [], async () => ({
      value: {},
      hasNextPage: false,
    })),
  );
});
test("merge states preserve known GitHub values and unknown mergeability", () => {
  assert.deepEqual(pullMergeMetadata({ mergeable: null, mergeable_state: "blocked" }), [
    { label: "Mergeability", value: "Unknown" },
    { label: "Merge status", value: "Blocked" },
  ]);
  assert.deepEqual(pullMergeMetadata({ mergeable: false, mergeable_state: "dirty" }), [
    { label: "Mergeability", value: "Conflicting" },
    { label: "Merge status", value: "Conflicting" },
  ]);
  assert.deepEqual(pullMergeMetadata({ mergeable: true, mergeable_state: "clean" }), [
    { label: "Mergeability", value: "Mergeable" },
    { label: "Merge status", value: "Clean" },
  ]);
});
