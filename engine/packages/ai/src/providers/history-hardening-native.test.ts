// Written by Branch from google-gemini/gemini-cli@c6bccb7ecbf6d8368d995455dd725ed34466faad:packages/core/src/utils/historyHardening.ts (atlas AGENT-LOOP-0096). Verifies native signature/ID replay and the final SDK request boundary required by R-1633.
import { FinishReason, GenerateContentResponse, type Content } from "@google/genai";
import { expect, it } from "vitest";
import { createAssistantOutput } from "../transports/assistant-output.js";
import type { AssistantMessage, Message } from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { projectGoogleMessages, hardenGoogleContents } from "./google-messages.js";
import {
  runGoogleGenerateContentLifecycle,
  buildGoogleGenerateContentParams,
} from "./google-shared.js";
import { makeModel } from "./google-shared.test-helpers.js";
import { hardenHistory, SYNTHETIC_THOUGHT_SIGNATURE } from "./history-hardening.js";
const model = makeModel("gemini-3.1-pro-preview");
const assistant = (content: AssistantMessage["content"]) => ({
  ...createAssistantOutput(model),
  content,
});
it.each(["managed", "signed-parts"] as const)(
  "preserves opaque signature bytes and response IDs in %s replay",
  (replay) => {
    const signature = "  opaque-signature_URL+/==  ";
    const messages: Message[] = [
      assistant([
        { type: "toolCall", id: "a", name: "lookup", arguments: {}, thoughtSignature: signature },
        {
          type: "toolCall",
          id: "b",
          name: "lookup",
          arguments: {},
          thoughtSignature: "sig-second",
        },
      ]),
      ...["a", "b"].map((id) => ({
        role: "toolResult" as const,
        toolName: "lookup",
        toolCallId: id,
        content: [{ type: "text" as const, text: "ok" }],
        isError: false,
        timestamp: 1,
      })),
    ];
    const before = structuredClone(messages);
    const projected = projectGoogleMessages({
      model,
      messages,
      replay,
      requiresToolCallSignature: true,
    });
    expect(projected[0]?.parts.map((p) => p.thoughtSignature)).toEqual([signature, "sig-second"]);
    expect(projected[0]?.parts.map((p) => p.functionCall?.id)).toEqual(["a", "b"]);
    expect(projected[1]?.parts.map((p) => p.functionResponse?.id)).toEqual(["a", "b"]);
    expect(messages).toEqual(before);
  },
);
it("keeps signatures on every existing call and standard native result media", () => {
  const image = { inlineData: { mimeType: "image/png", data: "AAAA" } };
  const contents: Content[] = [
    {
      role: "model",
      parts: [
        { functionCall: { id: "a", name: "one", args: {} }, thoughtSignature: "opaque-first" },
        { functionCall: { id: "b", name: "two", args: {} }, thoughtSignature: "opaque-second" },
      ],
    },
    {
      role: "user",
      parts: [
        { functionResponse: { id: "b", name: "two", response: { ok: true }, parts: [image] } },
        { text: "more" },
        { functionResponse: { id: "a", name: "one", response: { ok: true } } },
      ],
    },
  ];
  const result = hardenGoogleContents(contents);
  expect(result.map((c) => c.role)).toEqual(["user", "model", "user"]);
  expect(result[1]?.parts?.map((p) => p.thoughtSignature)).toEqual([
    "opaque-first",
    "opaque-second",
  ]);
  expect(result[2]?.parts?.map((p) => p.functionResponse?.id)).toEqual(["a", "b", undefined]);
  expect(result[2]?.parts?.[1]?.functionResponse?.parts).toEqual([image]);
});
it("repairs missing results without modifying stored history or signature bytes", () => {
  const history = [
    {
      id: "m",
      content: {
        role: "model",
        parts: [{ functionCall: { id: "a", name: "one", args: {} }, thoughtSignature: "opaque" }],
      },
    },
  ];
  const before = structuredClone(history);
  const result = hardenHistory(history);
  expect(history).toEqual(before);
  expect(result[1]?.content.parts?.[0]?.thoughtSignature).toBe("opaque");
  expect(result[2]?.content.parts?.[0]?.functionResponse).toEqual({
    id: "a",
    name: "one",
    response: { error: "The tool execution result was lost due to context management truncation." },
  });
});
it("injects a synthetic signature only when the first call lost its signature", () => {
  const result = hardenGoogleContents([
    {
      role: "model",
      parts: [
        { functionCall: { id: "a", name: "one", args: {} } },
        { functionCall: { id: "b", name: "two", args: {} }, thoughtSignature: "own-second" },
      ],
    },
  ]);
  expect(result[1]?.parts?.map((p) => p.thoughtSignature)).toEqual([
    SYNTHETIC_THOUGHT_SIGNATURE,
    "own-second",
  ]);
});
it("hardens the final SDK request after the payload hook", async () => {
  const output = createAssistantOutput(model);
  const stream = new AssistantMessageEventStream();
  let sent: unknown;
  await runGoogleGenerateContentLifecycle({
    model,
    output,
    stream,
    buildParams: () => buildGoogleGenerateContentParams(model, { messages: [] }),
    options: {
      onPayload: () => ({
        model: model.id,
        contents: [
          {
            role: "model",
            parts: [
              {
                functionCall: { id: "lost", name: "lookup", args: {} },
                thoughtSignature: "opaque-token",
              },
            ],
          },
        ],
      }),
    },
    createClient: () => ({
      models: {
        generateContentStream: async (params) => {
          sent = params.contents;
          return (async function* () {
            const chunk = new GenerateContentResponse();
            chunk.candidates = [
              {
                content: { role: "model", parts: [{ text: "done" }] },
                finishReason: FinishReason.STOP,
              },
            ];
            yield chunk;
          })();
        },
      },
    }),
    nextToolCallId: () => "new",
  });
  expect(sent).toEqual([
    { role: "user", parts: [{ text: "[Continuing from previous AI thoughts...]" }] },
    {
      role: "model",
      parts: [
        {
          functionCall: { id: "lost", name: "lookup", args: {} },
          thoughtSignature: "opaque-token",
        },
      ],
    },
    {
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "lost",
            name: "lookup",
            response: {
              error: "The tool execution result was lost due to context management truncation.",
            },
          },
        },
      ],
    },
  ]);
  expect((await stream.result()).stopReason).toBe("stop");
});
