import type { ProviderHistoryCompat } from "./provider-history-compat.js";
// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/runner.ts (atlas AGENT-LOOP-0095). Adapted to Branch typed history bridge; assertions preserved.
import type { ProcessLLMRequestArgs } from "./types.js";
/** Sequential request hooks; Branch supplies its configured compatibility processor explicitly. */
export class ProcessorRunner {
  constructor(
    private options: {
      inputProcessors: ProviderHistoryCompat[];
      outputProcessors: unknown[];
      logger: unknown;
      agentName: string;
    },
  ) {}
  async runProcessLLMRequest(args: ProcessLLMRequestArgs) {
    let prompt = args.prompt;
    for (const processor of this.options.inputProcessors)
      prompt = processor.processLLMRequest({ ...args, prompt })?.prompt ?? prompt;
    return { prompt };
  }
}
