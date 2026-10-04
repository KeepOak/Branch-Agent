// Ported from google-gemini/gemini-cli packages/core/src/utils/nextSpeakerChecker.test.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SideQuery, SideQueryRequest } from "./agent-loop-side-query.js";
import {
  CHECK_PROMPT,
  checkNextSpeaker,
  NEXT_SPEAKER_SYSTEM_PROMPT,
  type NextSpeakerResponse,
} from "./next-speaker-check.js";
import type { AgentMessage } from "./runtime/index.js";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "./test-helpers/agent-message-fixtures.js";

function model(text: string): AgentMessage {
  return makeAgentAssistantMessage({ content: [{ type: "text", text }] });
}

describe("checkNextSpeaker", () => {
  let sideQuery: ReturnType<typeof vi.fn<SideQuery>>;
  const abortSignal = new AbortController().signal;

  const check = (messages: AgentMessage[]) =>
    checkNextSpeaker({ messages, sideQuery, abortSignal, onWarn: () => {} });
  const respond = (value: unknown) => sideQuery.mockResolvedValue(JSON.stringify(value));

  beforeEach(() => {
    sideQuery = vi.fn<SideQuery>();
  });

  it("should return null if history is empty", async () => {
    const result = await check([]);
    expect(result).toBeNull();
    expect(sideQuery).not.toHaveBeenCalled();
  });

  it("should return null if the last speaker was the user", async () => {
    const result = await check([makeAgentUserMessage({ content: "Hello" })]);
    expect(result).toBeNull();
    expect(sideQuery).not.toHaveBeenCalled();
  });

  it("should return { next_speaker: 'model' } when model intends to continue", async () => {
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: "Model stated it will do something.",
      next_speaker: "model",
    };
    respond(mockApiResponse);

    const result = await check([model("I will now do something.")]);
    expect(result).toEqual(mockApiResponse);
    expect(sideQuery).toHaveBeenCalledTimes(1);
  });

  it("should return { next_speaker: 'user' } when model asks a question", async () => {
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: "Model asked a question.",
      next_speaker: "user",
    };
    respond(mockApiResponse);

    const result = await check([model("What would you like to do?")]);
    expect(result).toEqual(mockApiResponse);
  });

  it("should return { next_speaker: 'user' } when model makes a statement", async () => {
    const mockApiResponse: NextSpeakerResponse = {
      reasoning: "Model made a statement, awaiting user input.",
      next_speaker: "user",
    };
    respond(mockApiResponse);

    const result = await check([model("This is a statement.")]);
    expect(result).toEqual(mockApiResponse);
  });

  it("should return null if the side call throws an error", async () => {
    sideQuery.mockRejectedValue(new Error("API Error"));

    const result = await check([model("Some model output.")]);
    expect(result).toBeNull();
  });

  it("should return null if the side call returns invalid JSON (missing next_speaker)", async () => {
    respond({ reasoning: "This is incomplete." });

    const result = await check([model("Some model output.")]);
    expect(result).toBeNull();
  });

  it("should return null if the side call returns a non-string next_speaker", async () => {
    respond({ reasoning: "Model made a statement, awaiting user input.", next_speaker: 123 });

    const result = await check([model("Some model output.")]);
    expect(result).toBeNull();
  });

  it("should return null if the side call returns an invalid next_speaker string value", async () => {
    respond({ reasoning: "Model made a statement, awaiting user input.", next_speaker: "neither" });

    const result = await check([model("Some model output.")]);
    expect(result).toBeNull();
  });

  it("should call the side query with the correct parameters", async () => {
    respond({ reasoning: "Model made a statement, awaiting user input.", next_speaker: "user" });

    await check([model("Some model output.")]);

    expect(sideQuery).toHaveBeenCalled();
    const request = sideQuery.mock.calls[0]?.[0] as SideQueryRequest;
    expect(request.systemPrompt).toBe(NEXT_SPEAKER_SYSTEM_PROMPT);
    expect(request.prompt).toContain("Some model output.");
    expect(request.prompt.endsWith(CHECK_PROMPT)).toBe(true);
    expect(request.signal).toBe(abortSignal);
  });

  // Engine-side cases: transcript shapes the curated-history rules see here.
  it("returns 'model' without a side call when the last message is a tool result", async () => {
    const result = await check(
      castAgentMessages([
        {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "read",
          content: [{ type: "text", text: "file" }],
          isError: false,
          timestamp: 0,
        },
      ]),
    );
    expect(result?.next_speaker).toBe("model");
    expect(sideQuery).not.toHaveBeenCalled();
  });

  it("returns 'model' without a side call for an empty model message", async () => {
    const result = await check([
      makeAgentUserMessage({ content: "go" }),
      makeAgentAssistantMessage({ content: [] }),
    ]);
    expect(result?.next_speaker).toBe("model");
    expect(sideQuery).not.toHaveBeenCalled();
  });

  it("accepts a ```json fenced reply", async () => {
    sideQuery.mockResolvedValue('```json\n{"reasoning":"r","next_speaker":"model"}\n```');
    const result = await check([model("Next, I will run the tests.")]);
    expect(result?.next_speaker).toBe("model");
  });
});
