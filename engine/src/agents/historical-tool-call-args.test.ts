// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_call_args.py (atlas AGENT-LOOP-0097). Converted core rewriting and pairing tests; Branch canonical block and checkpoint assertions added.
import { describe, expect, it } from "vitest";
import {
  pairToolCallResults,
  rewriteMessagesToolCallArgs,
  rewriteToolCallArgs,
  synchronizeHistoricalToolCallArgs,
} from "./historical-tool-call-args.js";
type RecordValue = Record<string, unknown>;
type Block = RecordValue & { type: string; extras?: RecordValue };
type Call = RecordValue & { id: unknown; args: unknown };
type Message = {
  role: string;
  content: Block[];
  tool_calls: Call[];
  tool_call_chunks?: Block[];
  additional_kwargs: { tool_calls?: RecordValue[] };
  response_metadata: RecordValue;
};
const ARGS = { path: "/mnt/user-data/outputs/report.md", content: "x".repeat(50) };
const NEW_ARGS = { ...ARGS, content: "[elided]" };
const replacements = new Map([["call-1", NEW_ARGS]]);
function message(id: unknown = "call-1"): Message {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "writing" },
      {
        type: "tool_use",
        id,
        name: "write_file",
        input: { ...ARGS },
        partial_json: JSON.stringify(ARGS),
      },
    ],
    tool_calls: [{ name: "write_file", id, args: { ...ARGS } }],
    additional_kwargs: {
      tool_calls: [
        { id, type: "function", function: { name: "write_file", arguments: JSON.stringify(ARGS) } },
      ],
    },
    response_metadata: {},
  };
}
function raw(m: Message, i = 0) {
  return m.additional_kwargs.tool_calls![i];
}
function rawFunction(m: Message) {
  return raw(m).function as RecordValue;
}
function call(id: unknown, name: unknown = "bash", args: unknown = { command: "ls" }) {
  const m = message(id);
  m.tool_calls = [{ id, name, args }];
  m.content = [];
  m.additional_kwargs = {};
  return m;
}
const human = () => ({ role: "user", content: "go" });
const result = (id: unknown, content = "ok") => ({ role: "toolResult", toolCallId: id, content });
function responses() {
  const m = message();
  m.content[1] = {
    type: "function_call",
    id: "fc_1",
    call_id: "call-1",
    name: "write_file",
    arguments: JSON.stringify(ARGS),
    status: "completed",
  };
  return m;
}
function v1() {
  const m = message();
  m.content[1] = {
    type: "tool_call",
    id: "call-1",
    name: "write_file",
    args: { ...ARGS },
    extras: { item_id: "fc_1", arguments: JSON.stringify(ARGS), status: "completed" },
  };
  return m;
}

describe("TestRewriteToolCallArgs", () => {
  it("test_no_matching_id_returns_same_object", () => {
    const m = message();
    expect(rewriteToolCallArgs(m, new Map([["other", NEW_ARGS]]))).toBe(m);
    expect(rewriteToolCallArgs(m, new Map())).toBe(m);
  });
  it("test_rewrites_every_surface_together", () => {
    const m = message(),
      n = rewriteToolCallArgs(m, replacements);
    expect(n).not.toBe(m);
    expect(n.tool_calls[0]).toEqual({ id: "call-1", name: "write_file", args: NEW_ARGS });
    expect(JSON.parse(String(rawFunction(n).arguments))).toEqual(NEW_ARGS);
    expect(rawFunction(n).name).toBe("write_file");
    expect(n.content[0]).toEqual({ type: "text", text: "writing" });
    expect(n.content[1]).toEqual({
      type: "tool_use",
      id: "call-1",
      name: "write_file",
      input: NEW_ARGS,
    });
    expect(JSON.stringify(n)).not.toContain(ARGS.content);
  });
  it("test_original_message_is_never_mutated", () => {
    const m = message();
    rewriteToolCallArgs(m, replacements);
    expect(m.tool_calls[0].args).toEqual(ARGS);
    expect(m.content[1].input).toEqual(ARGS);
    expect(m.content[1]).toHaveProperty("partial_json");
    expect(JSON.parse(String(rawFunction(m).arguments))).toEqual(ARGS);
  });
  it("test_untouched_sibling_calls_keep_identity", () => {
    const m = message();
    m.tool_calls.push({ id: "call-2", name: "bash", args: { command: "ls" } });
    const n = rewriteToolCallArgs(m, replacements);
    expect(n.tool_calls[1]).toBe(m.tool_calls[1]);
    expect(n.tool_calls[1].args).toEqual({ command: "ls" });
    expect(n.tool_calls[0].args).toEqual(NEW_ARGS);
  });
  it("test_rewrites_chunk_surfaces", () => {
    const m = message();
    m.tool_call_chunks = [
      {
        type: "tool_call_chunk",
        id: "call-1",
        name: "write_file",
        args: JSON.stringify(ARGS),
        index: 0,
      },
    ];
    const n = rewriteToolCallArgs(m, replacements);
    expect(n.tool_calls[0].args).toEqual(NEW_ARGS);
    expect(JSON.parse(String(n.tool_call_chunks![0].args))).toEqual(NEW_ARGS);
    expect(n.tool_call_chunks![0].index).toBe(0);
    expect(m.tool_call_chunks[0].args).toBe(JSON.stringify(ARGS));
  });
  it("test_flattened_raw_provider_variants", () => {
    const m = message();
    m.additional_kwargs.tool_calls = [
      { id: "call-1", arguments: JSON.stringify(ARGS) },
      { id: "call-2", args: { ...ARGS } },
      { id: "call-3", name: "write_file" },
    ];
    const n = rewriteToolCallArgs(
      m,
      new Map([...["call-1", "call-2", "call-3"].map((id) => [id, NEW_ARGS] as const)]),
    );
    expect(JSON.parse(String(raw(n).arguments))).toEqual(NEW_ARGS);
    expect(raw(n, 1).args).toEqual(NEW_ARGS);
    expect(raw(n, 2)).toBe(raw(m, 2));
    const malformed = {
      ...m,
      additional_kwargs: { tool_calls: [...m.additional_kwargs.tool_calls, "not-a-dict"] },
    };
    expect(rewriteToolCallArgs(malformed, replacements).additional_kwargs.tool_calls[3]).toBe(
      "not-a-dict",
    );
  });
  it("test_non_string_ids_never_match", () => {
    const m = message();
    m.content[1].id = ["list", "id"];
    raw(m).id = { dict: "id" };
    const n = rewriteToolCallArgs(m, replacements);
    expect(n.tool_calls[0].args).toEqual(NEW_ARGS);
    expect(n.content[1].input).toEqual(ARGS);
    expect(JSON.parse(String(rawFunction(n).arguments))).toEqual(ARGS);
  });
  it("test_result_is_deterministic", () => {
    const m = message();
    expect(rewriteToolCallArgs(m, replacements)).toEqual(rewriteToolCallArgs(m, replacements));
  });
});
describe("TestRewriteMessagesToolCallArgs", () => {
  it("test_returns_none_when_nothing_replaced", () => {
    expect(
      rewriteMessagesToolCallArgs([human(), message(), result("call-1")], () => undefined),
    ).toBeUndefined();
    expect(rewriteMessagesToolCallArgs([], () => NEW_ARGS)).toBeUndefined();
  });
  it("test_selector_sees_message_and_call_and_untouched_messages_keep_identity", () => {
    const h = human(),
      target = message(),
      other = call("call-2"),
      tool = result("call-1"),
      seen: unknown[] = [];
    const n = rewriteMessagesToolCallArgs([h, target, other, tool], (m, c) => {
      seen.push([m, c.id]);
      return c.name === "write_file" ? NEW_ARGS : undefined;
    })!;
    expect(seen).toEqual([
      [target, "call-1"],
      [other, "call-2"],
    ]);
    expect(n[0]).toBe(h);
    expect(n[1]).not.toBe(target);
    expect((n[1] as Message).tool_calls[0].args).toEqual(NEW_ARGS);
    expect(n[2]).toBe(other);
    expect(n[3]).toBe(tool);
    expect(target.tool_calls[0].args).toEqual(ARGS);
  });
  it("test_calls_without_a_string_id_are_not_offered", () => {
    const offered: unknown[] = [];
    expect(
      rewriteMessagesToolCallArgs([call(null)], (_m, c) => {
        offered.push(c);
        return NEW_ARGS;
      }),
    ).toBeUndefined();
    expect(offered).toEqual([]);
  });
});
describe("TestContentBlockVariants", () => {
  it("test_responses_function_call_block_matched_by_call_id_keeps_item_id", () => {
    const m = responses(),
      n = rewriteToolCallArgs(m, replacements),
      b = n.content[1];
    expect(JSON.parse(String(b.arguments))).toEqual(NEW_ARGS);
    expect(b.id).toBe("fc_1");
    expect(b.call_id).toBe("call-1");
    expect(b.status).toBe("completed");
    expect(n.content[0]).toBe(m.content[0]);
    expect(JSON.parse(String(m.content[1].arguments))).toEqual(ARGS);
  });
  it("test_responses_function_call_block_ignores_item_id_as_match_key", () => {
    const m = responses();
    expect(rewriteToolCallArgs(m, new Map([["fc_1", NEW_ARGS]]))).toBe(m);
  });
  it("test_v1_tool_call_block_rewrites_args_and_extras_arguments", () => {
    const m = v1(),
      n = rewriteToolCallArgs(m, replacements),
      b = n.content[1];
    expect(b.args).toEqual(NEW_ARGS);
    expect(JSON.parse(String(b.extras!.arguments))).toEqual(NEW_ARGS);
    expect(b.extras!.item_id).toBe("fc_1");
    expect(b.extras!.status).toBe("completed");
    expect(m.content[1].args).toEqual(ARGS);
    expect(JSON.parse(String(m.content[1].extras!.arguments))).toEqual(ARGS);
  });
  it("test_v1_tool_call_block_without_extras_arguments_gets_no_extras_entry", () => {
    const m = v1();
    m.content[1].extras = { item_id: "fc_1" };
    const n = rewriteToolCallArgs(m, replacements);
    expect(n.content[1].args).toEqual(NEW_ARGS);
    expect(n.content[1].extras).toEqual({ item_id: "fc_1" });
  });
  it("test_v1_tool_call_chunk_block_rewrites_serialized_args", () => {
    const m = message();
    m.content = [
      {
        type: "tool_call_chunk",
        id: "call-1",
        name: "write_file",
        args: JSON.stringify(ARGS),
        index: 0,
        extras: { item_id: "fc_1" },
      },
    ];
    m.tool_call_chunks = [
      { type: "tool_call_chunk", id: "call-1", args: JSON.stringify(ARGS), index: 0 },
    ];
    const n = rewriteToolCallArgs(m, replacements);
    expect(JSON.parse(String(n.content[0].args))).toEqual(NEW_ARGS);
    expect(n.content[0].extras).toEqual({ item_id: "fc_1" });
    expect(n.content[0].index).toBe(0);
    expect(JSON.parse(String(n.tool_call_chunks![0].args))).toEqual(NEW_ARGS);
    expect(JSON.parse(String(m.content[0].args))).toEqual(ARGS);
  });
  it("test_unrelated_block_types_pass_through_by_identity", () => {
    const m = responses();
    m.content[0] = { type: "reasoning", id: "rs_1", summary: [] };
    expect(rewriteToolCallArgs(m, replacements).content[0]).toBe(m.content[0]);
  });
});
function history() {
  const first = call("none");
  first.tool_calls = [];
  first.response_metadata = { id: "resp_a", model_name: "gpt-x" };
  const c = responses();
  c.response_metadata = { id: "resp_b", model_name: "gpt-x" };
  const later = call("none");
  later.tool_calls = [];
  later.response_metadata = { id: "resp_c" };
  return [human(), first, c, result("call-1", "Error: blocked"), later];
}
describe("TestResponseChainInvalidation", () => {
  it("test_rewrite_drops_resp_ids_from_every_ai_message", () => {
    const m = history(),
      n = rewriteMessagesToolCallArgs(m, (_m, c) => (c.id === "call-1" ? NEW_ARGS : undefined))!;
    expect(n.map((m) => m.role)).toEqual(m.map((m) => m.role));
    for (const i of [1, 2, 4]) {
      expect((n[i] as Message).response_metadata).not.toHaveProperty("id");
      expect(n[i]).not.toBe(m[i]);
    }
    expect((n[1] as Message).response_metadata).toEqual({ model_name: "gpt-x" });
    expect((n[2] as Message).tool_calls[0].args).toEqual(NEW_ARGS);
    expect(n[0]).toBe(m[0]);
    expect(n[3]).toBe(m[3]);
    expect((m[1] as Message).response_metadata.id).toBe("resp_a");
    expect((m[2] as Message).response_metadata.id).toBe("resp_b");
    expect((m[4] as Message).response_metadata.id).toBe("resp_c");
    expect((m[2] as Message).tool_calls[0].args).toEqual(ARGS);
  });
  it("test_non_resp_ids_are_left_alone", () => {
    const m = call("none");
    m.tool_calls = [];
    m.response_metadata = { id: "msg_01", model: "claude" };
    const n = rewriteMessagesToolCallArgs([m, message(), result("call-1")], () => NEW_ARGS)!;
    expect(n[0]).toBe(m);
    expect((n[0] as Message).response_metadata.id).toBe("msg_01");
  });
  it("test_no_rewrite_keeps_chain_ids", () => {
    const m = history();
    expect(rewriteMessagesToolCallArgs(m, () => undefined)).toBeUndefined();
    expect((m[2] as Message).response_metadata.id).toBe("resp_b");
  });
});
describe("TestPairToolCallResults", () => {
  it("test_pairs_each_call_with_the_result_that_answered_it", () => {
    const ai = call("call-1");
    ai.tool_calls.push({ id: "call-2", name: "bash", args: { command: "ls" } });
    const first = result("call-1", "1"),
      second = result("call-2", "2"),
      o = pairToolCallResults([human(), ai, second, first]);
    expect(o.map((o) => [o.index, o.message === ai, o.callId, o.result])).toEqual([
      [1, true, "call-1", first],
      [1, true, "call-2", second],
    ]);
    expect(o[0].name).toBe("bash");
    expect(o[0].args).toEqual({ command: "ls" });
  });
  it("test_unanswered_call_gets_no_result", () => {
    const o = pairToolCallResults([call("call-1")]);
    expect(o).toHaveLength(1);
    expect(o[0].result).toBeUndefined();
  });
  it("test_reused_ids_pair_per_occurrence_in_history_order", () => {
    const first = result("call-1", "first"),
      second = result("call-1", "second");
    expect(
      pairToolCallResults([call("call-1"), first, call("call-1"), second]).map((o) => [
        o.index,
        o.result,
      ]),
    ).toEqual([
      [0, first],
      [2, second],
    ]);
  });
  it("test_calls_without_a_string_id_are_skipped", () => {
    const ai = call("call-1");
    ai.tool_calls.push(
      { id: null, args: {} },
      { id: "", args: {} },
      { id: ["not", "a", "string"], args: {} },
    );
    expect(pairToolCallResults([ai, result("call-1")]).map((o) => o.callId)).toEqual(["call-1"]);
  });
  it("test_non_ai_messages_and_non_dict_calls_are_ignored", () => {
    const ai = call("call-1");
    (ai.tool_calls as unknown[]).push("not-a-dict");
    expect(
      pairToolCallResults([human(), result("call-9", "stray"), ai]).map((o) => o.callId),
    ).toEqual(["call-1"]);
  });
  it("test_accessors_tolerate_malformed_calls", () => {
    const ai = call("call-1");
    ai.tool_calls[0].args = "not-a-dict";
    delete ai.tool_calls[0].name;
    const [o] = pairToolCallResults([ai]);
    expect(o.name).toBe("");
    expect(o.args).toEqual({});
    expect(o.callId).toBe("call-1");
  });
  it("test_empty_history_pairs_nothing", () => {
    expect(pairToolCallResults([])).toEqual([]);
  });
  it("test_unanswered_call_never_consumes_a_later_turns_result_for_a_reused_id", () => {
    const rr = result("r1", "text"),
      lr = result("reused", "OK");
    expect(
      pairToolCallResults([
        call("reused", "bash", { path: "report.md" }),
        call("r1", "read_file"),
        rr,
        call("reused", "bash", { path: "notes.md" }),
        lr,
      ]).map((o) => [o.index, o.callId, o.result]),
    ).toEqual([
      [0, "reused", undefined],
      [1, "r1", rr],
      [3, "reused", lr],
    ]);
  });
  it("test_result_answers_only_the_most_recent_preceding_turn", () => {
    const fresh = result("call-y");
    expect(
      pairToolCallResults([call("call-x"), call("call-y"), result("call-x", "late"), fresh]).map(
        (o) => [o.callId, o.result],
      ),
    ).toEqual([
      ["call-x", undefined],
      ["call-y", fresh],
    ]);
  });
  it("test_stray_results_before_any_call_are_ignored", () => {
    const real = result("call-1", "real");
    expect(
      pairToolCallResults([result("call-1", "stray"), call("call-1"), real]).map((o) => [
        o.callId,
        o.result,
      ]),
    ).toEqual([["call-1", real]]);
  });
  it("test_second_result_for_an_answered_call_is_ignored", () => {
    const first = result("call-1", "first");
    expect(
      pairToolCallResults([call("call-1"), first, result("call-1", "duplicate")]).map((o) => [
        o.callId,
        o.result,
      ]),
    ).toEqual([["call-1", first]]);
  });
  it("test_non_ai_messages_between_call_and_result_do_not_break_pairing", () => {
    const ai = call("call-1");
    ai.tool_calls.push({ id: "call-2", args: {} });
    const first = result("call-1", "1"),
      second = result("call-2", "2");
    expect(
      pairToolCallResults([ai, first, human(), second]).map((o) => [o.callId, o.result]),
    ).toEqual([
      ["call-1", first],
      ["call-2", second],
    ]);
  });
});
function duplicates() {
  const m = message();
  m.tool_calls = [
    { id: "dup", name: "write_file", args: { path: "a.md", content: "a".repeat(50) } },
    { id: "dup", name: "write_file", args: { path: "b.md", content: "b".repeat(50) } },
    { id: "solo", name: "write_file", args: { path: "c.md", content: "c".repeat(50) } },
  ];
  m.content = m.tool_calls.map((c) => ({
    type: "tool_use",
    id: c.id,
    name: "write_file",
    input: c.args,
  }));
  m.additional_kwargs.tool_calls = m.tool_calls.map((c) => ({
    id: c.id,
    type: "function",
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));
  return m;
}
describe("TestDuplicateIdsWithinOneMessage", () => {
  it("test_duplicated_ids_are_never_offered_or_rewritten_on_any_surface", () => {
    const m = duplicates(),
      offered: unknown[] = [];
    const [n] = rewriteMessagesToolCallArgs([m], (_m, c) => {
      offered.push(c.id);
      return { ...(c.args as RecordValue), content: "[elided]" };
    })!;
    expect(offered).toEqual(["solo"]);
    expect(n.tool_calls.map((c) => (c.args as typeof ARGS).content[0])).toEqual(["a", "b", "["]);
    expect(n.content.map((b) => (b.input as typeof ARGS).content[0])).toEqual(["a", "b", "["]);
    expect(
      n.additional_kwargs.tool_calls!.map(
        (c) => JSON.parse(String((c.function as RecordValue).arguments)).content[0],
      ),
    ).toEqual(["a", "b", "["]);
    expect(n.tool_calls.map((c) => (c.args as typeof ARGS).path)).toEqual(["a.md", "b.md", "c.md"]);
  });
  it("test_message_with_only_duplicated_ids_passes_through_by_identity", () => {
    const m = duplicates();
    m.tool_calls.pop();
    expect(rewriteMessagesToolCallArgs([m], () => ({ content: "[elided]" }))).toBeUndefined();
    expect(rewriteToolCallArgs(m, new Map([["dup", { content: "[elided]" }]]))).not.toBe(m);
  });
  it("test_unhashable_sibling_id_neither_crashes_nor_blocks_the_rewrite", () => {
    const m = message();
    m.tool_calls.push(
      { name: "bash", id: ["not", "a", "string"], args: { command: "ls" } },
      { name: "bash", id: { nested: "dict" }, args: { command: "ls" } },
    );
    const [n] = rewriteMessagesToolCallArgs([m], (_m, c) =>
      c.id === "call-1" ? NEW_ARGS : undefined,
    )!;
    expect(n.tool_calls[0].args).toEqual(NEW_ARGS);
    expect(n.tool_calls.slice(1)).toEqual(m.tool_calls.slice(1));
  });
});
it("synchronizes Branch canonical arguments and clears replay checkpoints without mutating history", () => {
  const m = message();
  m.content.push({ type: "toolCall", id: "call-1", name: "write_file", arguments: NEW_ARGS });
  const checkpoint = {
    ...m,
    providerReplay: { type: "openai-responses-compaction" },
    branchResponsesInputReplay: { afterResponseId: "resp_a" },
  };
  const [n] = synchronizeHistoricalToolCallArgs([checkpoint]);
  expect(n.tool_calls[0].args).toEqual(NEW_ARGS);
  expect(JSON.stringify(n)).not.toContain(ARGS.content);
  expect(n.providerReplay).toBeUndefined();
  expect(n.branchResponsesInputReplay).toBeUndefined();
  expect(checkpoint.providerReplay).toBeDefined();
  expect(synchronizeHistoricalToolCallArgs([n])[0]).toBe(n);
});
