import assert from "node:assert/strict";
import { test } from "node:test";
import { updateLiveEditDiffProgress } from "./embedded-agent-live-edit-diff.js";
import {
  countStreamingFileMutationLines,
  readCompletedFileMutationDelta,
} from "./file-mutation-args.js";

test("streaming edit counters omit unchanged context", () => {
  assert.deepEqual(
    countStreamingFileMutationLines("edit", {
      edits: [{ oldText: "context\nold value\nend\n", newText: "context\nnew value\nend\n" }],
    }),
    { added: 1, removed: 1 },
  );
});
test("streaming edit counters aggregate disjoint edits and canonical aliases", () => {
  assert.deepEqual(
    countStreamingFileMutationLines("edit", {
      edits: [
        { old_string: "same\n", new_string: "same\nadded\n" },
        { oldText: "gone\n", newText: "" },
      ],
    }),
    { added: 1, removed: 1 },
  );
});
test("streaming edit counters retain newline boundary semantics", () => {
  assert.deepEqual(
    countStreamingFileMutationLines("edit", { oldText: "old\nlast", newText: "new\npartial" }),
    { added: 1, removed: 1 },
  );
});
test("completed task delta retains existing file mutation semantics", () => {
  assert.deepEqual(
    readCompletedFileMutationDelta("edit", {
      path: "/fixture.txt",
      oldText: "same\nold",
      newText: "same\nnew",
    }),
    { files: ["/fixture.txt"], added: 2, removed: 2 },
  );
});
test("real live diff caller corrects provisional removals as context arrives", () => {
  const state = new Map();
  const event = (partialJson: string) => ({
    type: "toolcall_delta",
    contentIndex: 0,
    partial: { content: [{ id: "call", name: "edit", partialJson }] },
  });
  const first = updateLiveEditDiffProgress(state, event('{"oldText":"same\\nold\\n","newText":"'));
  assert.deepEqual(first?.diff, { added: 0, removed: 2 });
  state.get("call").lastCheckedAtMs = 0;
  const second = updateLiveEditDiffProgress(
    state,
    event(JSON.stringify({ oldText: "same\nold\n", newText: "same\nnew\n" })),
  );
  assert.deepEqual(second?.diff, { added: 1, removed: 1 });
  updateLiveEditDiffProgress(state, { type: "toolcall_end", toolCall: { id: "call" } });
  assert.equal(state.size, 0);
});
