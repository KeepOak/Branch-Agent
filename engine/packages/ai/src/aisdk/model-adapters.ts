// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/aisdk/v4/model.ts;packages/core/src/llm/model/aisdk/v5/model.ts;packages/core/src/llm/model/aisdk/v6/model.ts (atlas AGENT-LOOP-0026). Adapted wrapper dispatch to Branch's one-turn provider contract.
import type { LanguageModelV1, LanguageModelV1CallOptions } from "@ai-sdk/provider-v4";
import type { LanguageModelV2, LanguageModelV2CallOptions } from "@ai-sdk/provider-v5";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider-v6";
import { createStreamFromGenerateResult, type AiSdkStreamPart } from "./generate-to-stream.js";

export type AiSdkLanguageModel = LanguageModelV1 | LanguageModelV2 | LanguageModelV3;
export type AiSdkCallOptions =
  | LanguageModelV1CallOptions
  | LanguageModelV2CallOptions
  | LanguageModelV3CallOptions;

function applyStrictForV2(options: LanguageModelV2CallOptions): LanguageModelV2CallOptions {
  if (!options.tools?.length) return options;
  let hasStrictTool = false;
  const tools = options.tools.map((tool) => {
    if (tool.type !== "function" || !("strict" in tool)) return tool;
    if (tool.strict === true) hasStrictTool = true;
    const { strict: _strict, ...rest } = tool;
    return rest;
  });
  const openai = options.providerOptions?.openai ?? {};
  return {
    ...options,
    tools,
    ...(hasStrictTool && openai.strictJsonSchema == null
      ? {
          providerOptions: {
            ...options.providerOptions,
            openai: { ...openai, strictJsonSchema: true },
          },
        }
      : {}),
  };
}

function legacyGenerateResult(result: Awaited<ReturnType<LanguageModelV1["doGenerate"]>>) {
  const content: AiSdkStreamPart[] = [];
  if (result.text !== undefined) content.push({ type: "text", text: result.text });
  if (typeof result.reasoning === "string")
    content.push({ type: "reasoning", text: result.reasoning });
  else
    for (const part of result.reasoning ?? []) {
      if (part.type === "text")
        content.push({
          type: "reasoning",
          text: part.text,
          providerMetadata: { signature: part.signature },
        });
      else content.push({ ...part });
    }
  for (const call of result.toolCalls ?? []) {
    content.push({
      type: "tool-call",
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.args,
    });
  }
  return createStreamFromGenerateResult({ ...result, warnings: result.warnings ?? [], content });
}

/** Type correlation is narrowed at the version boundary; each prompt is built for that version. */
export async function streamSdkModel(
  model: AiSdkLanguageModel,
  options: AiSdkCallOptions,
  method: "generate" | "stream",
): Promise<ReadableStream<AiSdkStreamPart>> {
  switch (model.specificationVersion) {
    case "v1": {
      const call = options as LanguageModelV1CallOptions;
      if (method === "generate") return legacyGenerateResult(await model.doGenerate(call));
      const result = await model.doStream(call);
      return result.stream.pipeThrough(
        new TransformStream({ transform: (part, controller) => controller.enqueue({ ...part }) }),
      );
    }
    case "v2": {
      const call = applyStrictForV2(options as LanguageModelV2CallOptions);
      if (method === "generate") {
        const result = await model.doGenerate(call);
        return createStreamFromGenerateResult({
          ...result,
          content: result.content.map((part) => ({ ...part })),
        });
      }
      const result = await model.doStream(call);
      return result.stream.pipeThrough(
        new TransformStream({ transform: (part, controller) => controller.enqueue({ ...part }) }),
      );
    }
    case "v3": {
      const call = options as LanguageModelV3CallOptions;
      if (method === "generate") {
        const result = await model.doGenerate(call);
        return createStreamFromGenerateResult({
          ...result,
          content: result.content.map((part) => ({ ...part })),
        });
      }
      const result = await model.doStream(call);
      return result.stream.pipeThrough(
        new TransformStream({ transform: (part, controller) => controller.enqueue({ ...part }) }),
      );
    }
  }
}
