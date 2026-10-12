import assert from "node:assert/strict";
import { it } from "node:test";
import { projectMemoryWikiImportInsight } from "./import-insights.ts";
import type { WikiPageSummary } from "./markdown.ts";

const summary: WikiPageSummary = {
  absolutePath: "/isolated-test/sources/conversation.md",
  relativePath: "sources/conversation.md", kind: "source", pageType: "source",
  title: "ChatGPT Export: Documentation", hasFrontmatter: true,
  aliases: [], sourceIds: [], linkTargets: [], claims: [], contradictions: [], questions: [],
  relationships: [], bestUsedFor: [], notEnoughFor: [], bridgeAgentIds: [],
};
const frontmatter = { sourceType: "chatgpt-export", riskLevel: "low", labels: ["topic/work"] };
const body = [
  "## Auto Triage", "- Active-branch messages: 3", "## Auto Digest",
  "- User messages: 1", "- Assistant messages: 2", "- Preference signals: none detected",
  "## Active Branch Transcript", "### User", "Explain the command.", "### Assistant",
  "## Example", "```markdown", "### User", "## Notes", "```", "Use version one.",
  "### Assistant", "You're right, use version two.", "## Notes",
  "<!-- branch:human:start -->", "Private owner note.", "<!-- branch:human:end -->",
].join("\n");

it("uses the fixed parser in the actual import-insight projection", () => {
  const insight = projectMemoryWikiImportInsight(summary, { frontmatter, body });
  assert.ok(insight);
  assert.equal(insight.userMessageCount, 1);
  assert.equal(insight.assistantMessageCount, 2);
  assert.deepEqual(insight.correctionSignals, ["You're right, use version two."]);
  assert.deepEqual(insight.candidateSignals, ["Correction detected: You're right, use version two."]);
  assert.ok(!JSON.stringify(insight).includes("Private owner note."));
});

it("continues withholding correction and preference candidates for gated imported content", () => {
  const withheld = body.replace("- User messages: 1", "- Auto digest withheld from durable-candidate generation until reviewed.");
  const insight = projectMemoryWikiImportInsight(summary, { frontmatter, body: withheld });
  assert.ok(insight);
  assert.equal(insight.digestStatus, "withheld");
  assert.deepEqual(insight.candidateSignals, []);
  assert.deepEqual(insight.correctionSignals, []);
  assert.deepEqual(insight.preferenceSignals, []);
  assert.equal(insight.assistantOpener, undefined);
});
