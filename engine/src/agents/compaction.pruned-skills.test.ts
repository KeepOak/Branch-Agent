import { beforeEach, expect, it, vi } from "vitest";
import { SummaryOutputBudgetError } from "../../packages/agent-core/src/harness/types.js";
import {
  skillPrunedMarker,
  extractPrunedSkillNames,
} from "../skills/runtime/pruned-skill-markers.js";
import type { AgentMessage } from "./runtime/index.js";
import { buildSkillsSection } from "./system-prompt-skills.js";

const mocks = vi.hoisted(() => ({ summarize: vi.fn(), chunks: vi.fn() }));
vi.mock("./sessions/index.js", () => ({ generateSummary: mocks.summarize }));
vi.mock("./compaction-planning-worker.js", () => ({
  buildStageSplitPlanWithWorker: async () => ({ mode: "single" }),
  buildSummaryChunksWithWorker: mocks.chunks,
  buildOversizedFallbackPlanWithWorker: async () => ({ smallMessages: [], oversizedNotes: [] }),
}));

const { summarizeInStages } = await import("./compaction.js");
type Params = Parameters<typeof summarizeInStages>[0];
const params = (messages: AgentMessage[], previousSummary?: string): Params => ({
  messages,
  previousSummary,
  model: { contextWindow: 100_000 } as Params["model"],
  apiKey: "fixture-only",
  reserveTokens: 1000,
  maxChunkTokens: 8000,
  contextWindow: 100_000,
  signal: new AbortController().signal,
});
const marked = (name: string): AgentMessage => ({
  role: "user",
  content: skillPrunedMarker(name),
  timestamp: 1,
});

beforeEach(() => {
  mocks.summarize.mockReset().mockResolvedValue("## Goal\nContinue the task.");
  mocks.chunks.mockReset().mockImplementation(async ({ messages }) => [messages]);
});

it("reinserts paraphrased markers through the public native compaction caller", async () => {
  const summary = await summarizeInStages(params([marked("pdf")]));
  expect(summary).toContain(skillPrunedMarker("pdf"));
  expect(mocks.summarize).toHaveBeenCalledTimes(1);
});

it("re-derives lost skills from original native read bodies before truncating summarizer input", async () => {
  const messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "skill", name: "skills_read", arguments: { name: "pdf" } }],
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "skill",
      toolName: "skills_read",
      content: [{ type: "text", text: "x".repeat(6000) }],
      timestamp: 2,
      isError: false,
    },
  ] as AgentMessage[];
  expect(await summarizeInStages(params(messages))).toContain(skillPrunedMarker("pdf"));
});

it("retains markers from an iterative previous summary and applies the source first-20 collection bound", async () => {
  const previous = Array.from({ length: 25 }, (_, index) =>
    skillPrunedMarker(`skill-${index}`),
  ).join("\n");
  const summary = await summarizeInStages(
    params([{ role: "user", content: "next task", timestamp: 1 }], previous),
  );
  expect(extractPrunedSkillNames(summary)).toEqual(
    Array.from({ length: 20 }, (_, index) => `skill-${index}`),
  );
});

it("keeps a newly lost native read ahead of 25 older previous-summary markers", async () => {
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "toolCall", id: "fresh", name: "skills_read", arguments: { name: "new-skill" } },
      ],
      timestamp: 1,
    },
    {
      role: "toolResult",
      toolCallId: "fresh",
      toolName: "skills_read",
      content: [{ type: "text", text: "x".repeat(6000) }],
      timestamp: 2,
      isError: false,
    },
  ] as AgentMessage[];
  const previous = Array.from({ length: 25 }, (_, index) => skillPrunedMarker(`old-${index}`)).join(
    "\n",
  );
  const summary = await summarizeInStages(params(messages, previous));
  expect(extractPrunedSkillNames(summary)).toEqual([
    "new-skill",
    ...Array.from({ length: 19 }, (_, index) => `old-${index}`),
  ]);
});

it("also restores markers on the existing partial-summary fallback path", async () => {
  const messages = [
    marked("pdf"),
    { role: "user", content: "later", timestamp: 2 } as AgentMessage,
  ];
  mocks.chunks.mockResolvedValue(messages.map((message) => [message]));
  mocks.summarize
    .mockResolvedValueOnce("partial source summary")
    .mockRejectedValue(new SummaryOutputBudgetError("fixture budget"));
  const summary = await summarizeInStages(params(messages));
  expect(summary).toContain("Partial summary:");
  expect(summary).toContain(skillPrunedMarker("pdf"));
});

it("tells the real system prompt how to reload instead of pretending instructions survived", () => {
  const prompt = buildSkillsSection({
    skillsPrompt: "<available_skills />",
    readToolName: "read",
    installedSkillRead: true,
  }).join("\n");
  expect(prompt).toContain("[SKILL_PRUNED:");
  expect(prompt).toContain("Reload the named skill with skills_read");
  expect(prompt).toContain("one reload is enough");
});
