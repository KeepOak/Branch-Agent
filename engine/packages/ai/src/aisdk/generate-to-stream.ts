// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/aisdk/generate-to-stream.ts (atlas AGENT-LOOP-0026). Split emission into typed helpers; content and metadata are preserved.
export type AiSdkStreamPart = { type: string; [key: string]: unknown };
export type AiSdkGenerateResult = {
  warnings: unknown[];
  response?: { id?: string; modelId?: string; timestamp?: Date };
  content: AiSdkStreamPart[];
  finishReason: unknown;
  usage: unknown;
  providerMetadata?: unknown;
};
type Controller = ReadableStreamDefaultController<AiSdkStreamPart>;

function enqueueToolCall(controller: Controller, part: AiSdkStreamPart): void {
  controller.enqueue({
    type: "tool-input-start",
    id: part.toolCallId,
    toolName: part.toolName,
    providerExecuted: part.providerExecuted,
    dynamic: part.dynamic,
    providerMetadata: part.providerMetadata,
  });
  controller.enqueue({
    type: "tool-input-delta",
    id: part.toolCallId,
    delta: part.input,
    providerMetadata: part.providerMetadata,
  });
  controller.enqueue({
    type: "tool-input-end",
    id: part.toolCallId,
    providerMetadata: part.providerMetadata,
  });
  controller.enqueue(part);
}

function enqueueText(controller: Controller, part: AiSdkStreamPart): void {
  const prefix = part.type === "text" ? "text" : "reasoning";
  const id = `${part.type === "text" ? "msg" : "reasoning"}_${globalThis.crypto.randomUUID()}`;
  controller.enqueue({ type: `${prefix}-start`, id, providerMetadata: part.providerMetadata });
  controller.enqueue({
    type: `${prefix}-delta`,
    id,
    delta: part.text,
    providerMetadata: part.providerMetadata,
  });
  controller.enqueue({ type: `${prefix}-end`, id, providerMetadata: part.providerMetadata });
}

function enqueueSource(controller: Controller, part: AiSdkStreamPart): void {
  const common = {
    type: "source",
    id: part.id,
    title: part.title,
    providerMetadata: part.providerMetadata,
  };
  controller.enqueue(
    part.sourceType === "url"
      ? { ...common, sourceType: "url", url: part.url }
      : { ...common, sourceType: "document", mediaType: part.mediaType, filename: part.filename },
  );
}

function enqueueContent(
  controller: Controller,
  part: AiSdkStreamPart,
  tools: Map<unknown, unknown>,
): void {
  switch (part.type) {
    case "tool-call":
      tools.set(part.toolCallId, part.providerExecuted);
      enqueueToolCall(controller, part);
      return;
    case "tool-result": {
      const providerExecuted = tools.get(part.toolCallId);
      controller.enqueue(providerExecuted ? { ...part, providerExecuted } : part);
      return;
    }
    case "text":
    case "reasoning":
      enqueueText(controller, part);
      return;
    case "source":
      enqueueSource(controller, part);
      return;
    case "file":
      controller.enqueue({
        type: "file",
        mediaType: part.mediaType,
        data: part.data,
        providerMetadata: part.providerMetadata,
      });
      return;
    case "reasoning-file":
    case "custom":
      controller.enqueue(part);
      return;
    default:
      controller.enqueue({ type: "raw", rawValue: part });
  }
}

export function createStreamFromGenerateResult(
  result: AiSdkGenerateResult,
): ReadableStream<AiSdkStreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: result.warnings });
      controller.enqueue({
        type: "response-metadata",
        id: result.response?.id,
        modelId: result.response?.modelId,
        timestamp: result.response?.timestamp,
      });
      const tools = new Map<unknown, unknown>();
      for (const part of result.content) {
        enqueueContent(controller, part, tools);
      }
      controller.enqueue({
        type: "finish",
        finishReason: result.finishReason,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
      });
      controller.close();
    },
  });
}
