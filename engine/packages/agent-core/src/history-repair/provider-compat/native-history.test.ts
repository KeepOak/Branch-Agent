import type { Message, Context } from "@branch/llm-core";
import { expect, it } from "vitest";
import {
  captureAgentLoop,
  config,
  makeAssistantMessage,
  makeCall,
  model,
  reply,
  user,
} from "../../agent-loop.test-support.js";
// Written by Branch from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/provider-history-compat.ts (atlas AGENT-LOOP-0095). Verifies production request rewrites and one reactive retry while preserving stored identities.
import {
  attachInternalToolResultProvenance,
  getInternalToolResultProvenance,
} from "../../internal-hooks.js";
import { prepareCompatibleContext, repairRejectedContext } from "./native-history.js";
const anthropic = {
  ...model,
  api: "anthropic-messages",
  provider: "anthropic",
  id: "claude-sonnet-4-5",
};
it("rewrites native call/result IDs without changing stored history", async () => {
  const context: Context = {
    messages: [
      makeAssistantMessage([makeCall("search", "a.b"), makeCall("search", "a_b")]),
      ...["a.b", "a_b"].map((id) => ({
        role: "toolResult" as const,
        toolName: "search",
        toolCallId: id,
        content: [{ type: "text" as const, text: "ok" }],
        timestamp: 1,
        isError: false,
      })),
    ],
  };
  const provenance = { owner: "shared-safety-layer" };
  attachInternalToolResultProvenance(context.messages[1]!, provenance);
  const before = structuredClone(context);
  const result = await prepareCompatibleContext(context, anthropic);
  expect(
    result.messages[0]?.role === "assistant" &&
      result.messages[0].content.filter((c) => c.type === "toolCall").map((c) => c.id),
  ).toEqual(["a_b_2", "a_b"]);
  expect(result.messages.slice(1).map((m) => m.role === "toolResult" && m.toolCallId)).toEqual([
    "a_b_2",
    "a_b",
  ]);
  expect(getInternalToolResultProvenance(result.messages[1]!)).toBe(provenance);
  expect(context).toEqual(before);
});
it("rewrites Azure system/user reminder tags through the actual loop", async () => {
  let request: Context | undefined;
  await captureAgentLoop(
    [user("<system-reminder>now</system-reminder>")],
    { systemPrompt: "<system-reminder>context</system-reminder>", messages: [] },
    { ...config, model: { ...model, provider: "azure-openai", api: "azure-openai-responses" } },
    undefined,
    (_model, context) => {
      request = context;
      return reply(makeAssistantMessage([{ type: "text", text: "done" }]));
    },
  ).result;
  expect(request?.systemPrompt).toBe("<memory-context>context</memory-context>");
  expect(request?.messages[0]?.content).toBe("<memory-context>now</memory-context>");
});
it("retries provider rejection once and preserves paired native IDs", async () => {
  const history: Message[] = [
    makeAssistantMessage([makeCall("search", "call.bad")]),
    {
      role: "toolResult",
      toolName: "search",
      toolCallId: "call.bad",
      content: [{ type: "text", text: "ok" }],
      timestamp: 1,
      isError: false,
    },
  ];
  const before = structuredClone(history);
  const requests: Message[][] = [];
  const run = captureAgentLoop(
    [user("continue")],
    { systemPrompt: "", messages: history },
    config,
    undefined,
    (_model, context) => {
      requests.push(context.messages);
      return reply(
        requests.length === 1
          ? {
              ...makeAssistantMessage([]),
              stopReason: "error",
              errorMessage: "tool_use.id: should match pattern",
            }
          : makeAssistantMessage([{ type: "text", text: "recovered" }]),
      );
    },
  );
  await run.result;
  expect(requests).toHaveLength(2);
  expect(requests[1]?.slice(0, 2)).toEqual([
    { ...before[0], content: [{ ...makeCall("search", "call.bad"), id: "call_bad" }] },
    { ...before[1], toolCallId: "call_bad" },
  ]);
  expect(history).toEqual(before);
  expect(
    run.events.filter((e) => e.type === "message_end" && e.message.role === "assistant"),
  ).toHaveLength(1);
});
it("clears rejected OpenAI item references and keeps visible content and phase", async () => {
  const context: Context = {
    messages: [
      {
        ...makeAssistantMessage([
          {
            type: "text",
            text: "visible",
            textSignature: '{"v":1,"id":"msg_orphan","phase":"final_answer"}',
          },
        ]),
        api: "openai-responses",
        provider: "openai",
      },
    ],
  };
  const result = await repairRejectedContext(
    context,
    "Item 'msg_orphan' of type 'message' was provided without its required 'reasoning' item: 'rs_missing'",
    0,
  );
  expect(result?.messages[0]?.content).toEqual([
    { type: "text", text: "visible", textSignature: '{"v":1,"phase":"final_answer"}' },
  ]);
  expect(
    await repairRejectedContext(
      context,
      "Item 'msg_orphan' of type 'message' was provided without its required 'reasoning' item",
      1,
    ),
  ).toBeUndefined();
});
it("retains a thinking-only row separated from the next assistant by a user turn", async () => {
  const context: Context = {
    messages: [
      {
        ...makeAssistantMessage([
          { type: "thinking", thinking: "earlier", thinkingSignature: "old-sig" },
        ]),
        api: "anthropic-messages",
        provider: "anthropic",
      },
      user("new turn") as Message,
      {
        ...makeAssistantMessage([{ type: "text", text: "new answer" }]),
        api: "anthropic-messages",
        provider: "anthropic",
      },
    ],
  };
  expect(
    await repairRejectedContext(
      context,
      "thinking or redacted_thinking blocks in the latest assistant message cannot be modified",
      0,
    ),
  ).toBeUndefined();
});
