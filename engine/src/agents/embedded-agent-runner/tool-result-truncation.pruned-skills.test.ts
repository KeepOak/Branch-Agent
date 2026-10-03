import { expect, it } from "vitest";
import {
  extractPrunedSkillNames,
  skillMessageText,
  skillPrunedMarker,
} from "../../skills/runtime/pruned-skill-markers.js";
import type { AgentMessage } from "../runtime/index.js";
import { createInstalledSkillTools } from "../tools/installed-skill-tools.js";
import { createToolResultPromptProjectionState } from "./session-prompt-state.js";
import {
  pruneExpiredCacheTtlToolResults,
  resolveCacheTtlPruningSettings,
} from "./tool-result-truncation.js";

const assistant = (content: unknown = []) =>
  ({ role: "assistant", content, timestamp: 1 }) as AgentMessage;
const user = (content: string) => ({ role: "user", content, timestamp: 1 }) as AgentMessage;

async function history(size: number, trailingFillers: number) {
  const instructions = `# Real fixture skill\n${"x".repeat(size)}`;
  const read = createInstalledSkillTools([
    {
      name: "fixture-skill",
      description: "Native installed skill fixture",
      location: "fixture://skill/SKILL.md",
      source: { filePath: "/no-ambient-files/SKILL.md", readContent: instructions },
    },
  ]).find((tool) => tool.name === "skills_read")!;
  const result = await read.execute("native-read", { name: "fixture-skill" });
  const messages = [
    user("load skill"),
    assistant([
      {
        type: "toolCall",
        id: "native-read",
        name: "skills_read",
        arguments: { name: "fixture-skill" },
      },
    ]),
    {
      role: "toolResult",
      toolCallId: "native-read",
      toolName: "skills_read",
      content: result.content,
      details: result.details,
      isError: false,
      timestamp: 2,
    } as AgentMessage,
    ...Array.from({ length: trailingFillers }, (_, index) =>
      index % 2 ? assistant() : user("filler"),
    ),
    user("second"),
    assistant(),
    user("third"),
    assistant(),
    user("latest"),
    assistant(),
  ];
  return { instructions, messages, read };
}

function project(messages: AgentMessage[], contextWindowTokens = 1000) {
  return pruneExpiredCacheTtlToolResults({
    messages,
    contextWindowTokens,
    settings: resolveCacheTtlPruningSettings({ mode: "cache-ttl" })!,
    now: 1_000_000,
    lastCacheTouchAt: 600_000,
    dropThinkingBlocksForEstimate: false,
    projectionState: createToolResultPromptProjectionState(),
    pruneNewRounds: true,
  });
}

it("marks a real installed skill body lost during native soft projection while leaving persisted source whole", async () => {
  const { messages, instructions, read } = await history(6000, 12);
  const projected = project(messages);
  const result = projected.find((message) => message.role === "toolResult")!;
  expect(JSON.stringify(result)).toContain("[SKILL_PRUNED:");
  expect(JSON.stringify(result)).toContain("skills_read");
  expect(messages[2]).toMatchObject({ content: [{ type: "text", text: instructions }] });
  const [name] = extractPrunedSkillNames(skillMessageText(result));
  const reloaded = await read.execute("native-reload", { name });
  expect(reloaded.content).toEqual([{ type: "text", text: instructions }]);
});

it("preserves a just-loaded native skill body through ordinary pruning", async () => {
  const { messages, instructions } = await history(6000, 0);
  expect(project(messages)[2]).toMatchObject({ content: [{ type: "text", text: instructions }] });
});

it("lets native pressure clearing override recent protection and supplies the exact reload marker", async () => {
  const { messages } = await history(60000, 0);
  const result = project(messages)[2];
  expect(result).toMatchObject({
    content: [{ type: "text", text: expect.stringContaining(skillPrunedMarker("fixture-skill")) }],
  });
});

it("does not mark small reads or infer skill identity from ambient read paths", async () => {
  const { messages, instructions } = await history(4500, 12);
  expect(project(messages)[2]).toMatchObject({ content: [{ type: "text", text: instructions }] });
});

it("preserves an older skill referenced by a user in the retained tail", async () => {
  const { messages, instructions } = await history(6000, 12);
  messages[messages.length - 2] = user("Continue using FIXTURE-SKILL now");
  expect(project(messages)[2]).toMatchObject({ content: [{ type: "text", text: instructions }] });
});
