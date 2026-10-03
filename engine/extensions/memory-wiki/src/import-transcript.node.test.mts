import assert from "node:assert/strict";
import { describe, it } from "node:test";

const source = process.env.BRANCH_IMPORT_TRANSCRIPT_BASELINE ??
  new URL("./import-transcript.ts", import.meta.url).href;
const { parseTranscriptTurns } = await import(source);
const page = (...lines: string[]) => ["## Active Branch Transcript", ...lines].join("\n");

describe("imported transcript boundaries", () => {
  it("retains ordinary Markdown headings and subsequent genuine turns", () => {
    assert.deepEqual(parseTranscriptTurns(page(
      "### User", "Explain it", "### Assistant", "## Answer", "Use the docs.",
      "### User", "That was wrong.", "### Assistant", "You're right, use version two.",
      "## Notes", "This owner note is outside the transcript.",
    )), [
      { role: "user", text: "Explain it" },
      { role: "assistant", text: "## Answer\nUse the docs." },
      { role: "user", text: "That was wrong." },
      { role: "assistant", text: "You're right, use version two." },
    ]);
  });

  for (const opener of ["```markdown", "~~~markdown", "   ```markdown"]) {
    it(`keeps speaker and section headings inside ${opener} as content`, () => {
      const closer = opener.includes("~") ? "~~~" : "```";
      const text = ["Example:", opener, "### User", "## Notes", "## Example", closer, "Done."].join("\n");
      assert.deepEqual(parseTranscriptTurns(page("### Assistant", text, "### User", "Thanks", "## Notes", "private note")),
        [{ role: "assistant", text }, { role: "user", text: "Thanks" }]);
    });
  }

  it("requires a same-marker closing fence at least as long as its opener", () => {
    const text = ["````markdown", "```", "~~~", "### User", "````", "Done."].join("\n");
    assert.deepEqual(parseTranscriptTurns(page("### Assistant", text, "### User", "Next")),
      [{ role: "assistant", text }, { role: "user", text: "Next" }]);
  });

  it("does not treat an info-bearing fence as a closing fence", () => {
    const text = ["~~~", "~~~language", "### User", "~~~"].join("\n");
    assert.deepEqual(parseTranscriptTurns(page("### Assistant", text)), [{ role: "assistant", text }]);
  });

  it("keeps an unclosed fence as content through end of input", () => {
    const text = "```markdown\n### User\n## Notes";
    assert.deepEqual(parseTranscriptTurns(page("### Assistant", text)), [{ role: "assistant", text }]);
  });

  it("keeps actual host Notes outside an unclosed transcript fence", () => {
    const text = "```markdown\nStill message content.";
    assert.deepEqual(parseTranscriptTurns(page("### Assistant", text,
      "## Notes", "<!-- branch:human:start -->", "Owner-only note", "<!-- branch:human:end -->")),
      [{ role: "assistant", text }]);
  });

  it("does not split indented code into invented speakers or host sections", () => {
    const text = "Code:\n    ### User\n    ## Notes\n    example";
    assert.deepEqual(parseTranscriptTurns(page("### Assistant", text, "### User", "Next")),
      [{ role: "assistant", text }, { role: "user", text: "Next" }]);
  });

  it("preserves CRLF, empty-turn filtering and absence of the transcript section", () => {
    assert.deepEqual(parseTranscriptTurns(page("### User", "", "### Assistant", "Answer", "## Notes").replaceAll("\n", "\r\n")),
      [{ role: "assistant", text: "Answer" }]);
    assert.deepEqual(parseTranscriptTurns("## Auto Digest\n### User\nUnrelated"), []);
  });
});
