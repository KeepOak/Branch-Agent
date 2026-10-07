// From aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose-context-management/src/structured.rs (atlas AGENT-LOOP-0100). All ten source tests ported to Vitest; provenance and lossless-render fallback assertions added.
import { describe, expect, it } from "vitest";
import {
  applyStructuredSummary,
  parseStructuredSummary,
  renderStructuredSummary,
} from "./structured-summary.js";
const FULL_RESPONSE =
  "<analysis>\nThe user asked to fix a bug in parser.rs. I traced it to an off-by-one in {brace handling} and patched it.\n</analysis>\n```json\n" +
  JSON.stringify({
    user_intent: ["Fix the parser bug", "Add a regression test"],
    technical_concepts: ["off-by-one", "tokenizer"],
    files: [
      {
        path: "src/parser.rs",
        summary: "Fixed off-by-one in scan loop",
        key_code: "fn scan(&mut self) { .. }",
      },
    ],
    errors_and_fixes: ["Panic on empty input, fixed with early return"],
    problem_solving: ["Root-caused via failing unit test"],
    user_messages: ["fix the parser bug", "add a test"],
    pending_tasks: ["Add a regression test"],
    current_work: "Writing the regression test in tests/parser.rs",
    next_step: "Finish the regression test",
  }) +
  "\n```";
function parse(text: string) {
  const summary = parseStructuredSummary(text);
  expect(summary).toBeDefined();
  if (!summary) throw Error("should parse");
  return summary;
}
describe("StructuredSummary", () => {
  it("parses_fenced_json_after_analysis", () => {
    const s = parse(FULL_RESPONSE);
    expect(s.user_intent).toEqual(["Fix the parser bug", "Add a regression test"]);
    expect(s.files).toHaveLength(1);
    expect(s.files[0].path).toBe("src/parser.rs");
    expect(s.current_work).toBe("Writing the regression test in tests/parser.rs");
  });
  it("unusable_responses_fall_back_to_raw_text", () => {
    for (const text of [
      "Here is a summary of the conversation. The user asked about compaction.",
      "{}",
      '{"notes":"unknown fields alone are not a summary"}',
      '{"current_work":""}',
      '{"files":[{}],"user_intent":[" "]}',
      '```json\n{"user_intent":["Fix the bug"],"pending_tasks":["Write tests","Update docs',
      'The session focused on the parser migration. The tracker entry {"current_work":"migrate parser"} is unchanged, and tests still need porting.',
      '<analysis>reviewing</analysis>\nA prose recap: the config was set to {"user_intent":["quoted example"]} per the docs, then the run passed.',
      '<analysis>\nThe target shape is:\n```json\n{"user_intent":["example only"]}\n```\nNow let me review the conversation.\n</analysis>\nSorry, I ran out of room and could not produce the summary document.',
      '<analysis>\nThe prompt ends with </analysis> and shows the shape:\n```json\n{"user_intent":["example only"]}\n```\nNow let me review the conversation.\n</analysis>\nSorry, I ran out of room and could not produce the summary document.',
    ]) {
      expect(parseStructuredSummary(text), text).toBeUndefined();
      expect(applyStructuredSummary(text)).toBe(text);
    }
  });
  it("embedded_fences_in_string_values_do_not_break_extraction", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        user_intent: ["Document the build"],
        files: [
          { path: "README.md", summary: "Added build docs", key_code: "```bash\ncargo build\n```" },
        ],
        pending_tasks: ["Publish the docs"],
      }) +
      "\n```";
    const s = parse(text);
    expect(s.files[0].key_code).toBe("```bash\ncargo build\n```");
    expect(s.pending_tasks).toEqual(["Publish the docs"]);
    const quoted =
      "```json\n" +
      JSON.stringify({
        user_intent: ["Document the config"],
        files: [
          {
            path: "docs/config.md",
            summary: "Added config examples",
            key_code: '```json\n{"retries": 3}\n```',
          },
        ],
      }) +
      "\n```";
    expect(parse(quoted).files[0].key_code).toBe('```json\n{"retries": 3}\n```');
  });
  it("quoted_terminator_inside_summary_json_does_not_hide_it", () => {
    const text =
      "<analysis>\nThe session edited the compaction prompt itself.\n</analysis>\n```json\n" +
      JSON.stringify({
        user_intent: ["Rework the scratchpad prompt"],
        files: [
          {
            path: "prompts/compact.md",
            summary: "Tightened the <analysis>...</analysis> instructions",
          },
        ],
      }) +
      "\n```";
    const s = parse(text);
    expect(s.user_intent).toEqual(["Rework the scratchpad prompt"]);
    expect(s.files[0].summary).toBe("Tightened the <analysis>...</analysis> instructions");
  });
  it("retries_next_candidate_when_fenced_extraction_fails", () => {
    expect(
      parse(
        '<analysis>the model was told to emit ```json with {braces</analysis>\n{"user_intent":["Real goal"]}',
      ).user_intent,
    ).toEqual(["Real goal"]);
  });
  it("lenient_shapes_are_stringified_not_rejected", () => {
    const s = parse(
      JSON.stringify({
        user_intent: "fix the flaky test",
        errors_and_fixes: [
          { error: "cursor drifted after replay batch 34", fix: "bounded mpsc channel" },
          "plain string entry",
          null,
        ],
        pending_tasks: [42],
        current_work: { task: "regression test", status: "in progress" },
      }),
    );
    expect(s.user_intent).toEqual(["fix the flaky test"]);
    expect(s.errors_and_fixes).toEqual([
      "error: cursor drifted after replay batch 34; fix: bounded mpsc channel",
      "plain string entry",
    ]);
    expect(s.pending_tasks).toEqual(["42"]);
    expect(s.current_work).toBe("task: regression test; status: in progress");
  });
  it("file_entries_parse_leniently", () => {
    const s = parse(
      JSON.stringify({
        files: [
          "src/parser.rs",
          { path: "tests/parser.rs", summary: "Added regression test" },
          { path: "src/scan.rs", summary: 42, key_code: ["fn a() {}", "fn b() {}"] },
          "",
        ],
      }),
    );
    expect(s.files).toHaveLength(3);
    expect(s.files[0].path).toBe("src/parser.rs");
    expect(s.files[0].summary).toBe("");
    expect(s.files[1].summary).toBe("Added regression test");
    expect(s.files[2].summary).toBe("42");
    expect(s.files[2].key_code).toBe("fn a() {}; fn b() {}");
  });
  it("drops_blank_entries_but_keeps_content", () => {
    const s = parse(
      '{"user_intent":["","Fix the bug"],"files":[{"path":"a.rs","summary":"Patched","key_code":"  "}],"next_step":" "}',
    );
    expect(s.user_intent).toEqual(["Fix the bug"]);
    expect(s.files[0].key_code).toBeUndefined();
    expect(s.next_step).toBeUndefined();
  });
  it("renders_markdown_sections", () => {
    const rendered = renderStructuredSummary(parse(FULL_RESPONSE));
    for (const text of [
      "## User Intent",
      "- Fix the parser bug",
      "### src/parser.rs",
      "fn scan(&mut self) { .. }",
      "## Next Step",
    ])
      expect(rendered).toContain(text);
  });
  it("render_fences_exceed_backtick_runs_in_key_code", () => {
    const rendered = renderStructuredSummary(
      parse(
        JSON.stringify({
          files: [
            {
              path: "docs/build.md",
              summary: "Documented the build",
              key_code: "```bash\ncargo build\n```\n````\nnested fence docs\n````",
            },
          ],
          errors_and_fixes: ["None"],
        }),
      ),
    );
    expect(rendered.split("\n`````\n").length - 1).toBe(2);
    expect(rendered.indexOf("## Errors + Fixes")).toBeGreaterThan(
      rendered.lastIndexOf("\n`````\n"),
    );
  });
  it("provenance and uncertain entries come before goals and custom fields stay available", () => {
    const s = parse(
      JSON.stringify({
        provenance: ["Decision: owner message 42"],
        uncertain: ["Unverified inference"],
        user_intent: ["Finish work"],
        custom: "kept",
      }),
    );
    const rendered = renderStructuredSummary(s);
    expect(rendered.indexOf("## Provenance")).toBeLessThan(rendered.indexOf("## User Intent"));
    expect(rendered.indexOf("## Uncertain")).toBeLessThan(rendered.indexOf("## User Intent"));
    expect(s.extra.custom).toBe("kept");
  });
  it("keeps raw text when custom rendering fails or renders nothing", () => {
    expect(applyStructuredSummary(FULL_RESPONSE, () => " ")).toBe(FULL_RESPONSE);
    expect(
      applyStructuredSummary(FULL_RESPONSE, () => {
        throw Error("invalid template");
      }),
    ).toBe(FULL_RESPONSE);
  });
});
