import { test } from "node:test";
import assert from "node:assert/strict";
import { extractThoughtChain } from "./resume-export-plaintext.ts";
import { buildSessionRecap } from "./resume-session-recap.ts";

test("mandatory thought captures keep ordered trimmed contents", () => {
  assert.equal(extractThoughtChain("<thinking> first </thinking>visible<thought_chain>second</thought_chain>"), "first\n\nsecond");
  assert.equal(extractThoughtChain("visible only"), null);
});
test("recent recap bounds remain the source twenty visible turns", () => {
  const messages = Array.from({length: 22}, (_,index) => ({role: index % 2 ? "assistant" : "user",content: `turn ${index}`}));
  const result = buildSessionRecap(messages);
  assert.match(result,/10 user turns \/ 10 assistant replies \(of 11\/11 total\)/);
  assert.match(result,/Last ask: turn 20/); assert.match(result,/Last reply: turn 21/);
});
test("unknown tools count without inventing a file from undefined-key arguments", () => {
  const result = buildSessionRecap([{role:"assistant",tool_calls:[{function:{name:"get_time",arguments:{undefined:"invented-file.txt"}}}]}]);
  assert.match(result,/get_time×1/); assert.doesNotMatch(result,/Files touched|invented-file/);
});
test("recognized file tools preserve newest-first file identity", () => {
  const result=buildSessionRecap([{role:"assistant",tool_calls:[{function:{name:"read",arguments:{path:"first.ts"}}},{function:{name:"write_file",arguments:{path:"second.ts"}}}]}]);
  assert.match(result,/Files touched: second\.ts, first\.ts/);
});
