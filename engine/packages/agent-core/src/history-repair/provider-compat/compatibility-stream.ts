// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/provider-history-compat.ts (atlas AGENT-LOOP-0095). Branch stream boundary applies prompt rules and retries a repaired rejection once before admitting tool calls.
import type { Context } from "@branch/llm-core";
import { AssistantMessageEventStream } from "@branch/llm-core/event-stream";
import type { StreamFn } from "../../types.js";
import { prepareCompatibleContext, repairRejectedContext } from "./native-history.js";
export function compatibilityStream(stream: StreamFn): StreamFn {
  return async (model, originalContext, options) => {
    let context = await prepareCompatibleContext(originalContext, model);
    let response = await stream(model, context, options);
    let failure: unknown;
    const output = new AssistantMessageEventStream();
    void (async () => {
      let retryCount = 0;
      let admittedToolCall = false;
      for (;;) {
        let retry: Context | undefined;
        for await (const event of response) {
          if (event.type === "toolcall_start" || event.type === "toolcall_end")
            admittedToolCall = true;
          if (event.type === "error" && !admittedToolCall && event.error.stopReason === "error") {
            retry = await repairRejectedContext(
              context,
              event.error.errorMessage ?? "",
              retryCount,
            );
            if (retry) break;
          }
          output.push(event);
        }
        if (!retry) {
          output.end(await response.result());
          break;
        }
        context = await prepareCompatibleContext(retry, model);
        retryCount++;
        response = await stream(model, context, options);
      }
      output.end();
    })().catch((error) => {
      failure = error;
      output.end();
    });
    const result = output.result.bind(output);
    output.result = async () => {
      try {
        return await result();
      } catch (error) {
        throw failure ?? error;
      }
    };
    return output;
  };
}
