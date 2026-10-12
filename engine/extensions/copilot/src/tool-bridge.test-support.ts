import type { Tool as SdkTool, ToolInvocation } from "@github/copilot-sdk";
import { expectDefined } from "@branch/normalization-core";
import { createBranchCodingTools as createRealBranchCodingTools } from "branch/plugin-sdk/agent-harness";
import type { AnyAgentTool } from "branch/plugin-sdk/agent-harness-runtime";
import { createCopilotTestHostCapabilities } from "./host-capability.test-support.js";
import { createCopilotToolBridge as createCopilotToolBridgeImpl } from "./tool-bridge.js";

export type CopilotToolBridgeInput = Parameters<typeof createCopilotToolBridgeImpl>[0];
type CopilotToolBridgeAttemptParams = NonNullable<CopilotToolBridgeInput["attemptParams"]>;
type CopilotToolBridgeTestInput = Omit<
  CopilotToolBridgeInput,
  "agentId" | "attemptParams" | "modelId" | "modelProvider" | "sessionId" | "spawnWorkspaceDir"
> &
  Partial<Pick<CopilotToolBridgeInput, "agentId" | "modelId" | "modelProvider" | "sessionId">> & {
    createBranchCodingTools?: typeof createRealBranchCodingTools;
    sessionKey?: string;
    abortSignal?: AbortSignal;
    spawnWorkspaceDir?: CopilotToolBridgeInput["spawnWorkspaceDir"];
    attemptParams?: Omit<CopilotToolBridgeAttemptParams, "hostCapabilities"> &
      Partial<Pick<CopilotToolBridgeAttemptParams, "hostCapabilities">>;
  };
export type CopilotCodingToolsOptions = NonNullable<
  Parameters<typeof createRealBranchCodingTools>[0]
>;
const testHostCapabilities = createCopilotTestHostCapabilities(createRealBranchCodingTools);

export function createCopilotToolBridge(input: CopilotToolBridgeTestInput) {
  const { attemptParams, createBranchCodingTools, sessionKey, abortSignal, ...baseInput } = input;
  const preparedInput: CopilotToolBridgeInput = {
    agentId: "agent-1",
    modelId: "gpt-4o",
    modelProvider: "github-copilot",
    sessionId: "session-1",
    spawnWorkspaceDir: undefined,
    ...baseInput,
    attemptParams: {
      ...attemptParams,
      sessionKey: attemptParams?.sessionKey ?? sessionKey,
      abortSignal: abortSignal ?? attemptParams?.abortSignal,
      hostCapabilities:
        attemptParams?.hostCapabilities ??
        (createBranchCodingTools
          ? createCopilotTestHostCapabilities(createBranchCodingTools)
          : testHostCapabilities),
    },
  };
  return createCopilotToolBridgeImpl(preparedInput);
}
type ConvertToolOptions = Pick<CopilotToolBridgeInput, "onToolCompleted"> &
  Pick<CopilotToolBridgeAttemptParams, "abortSignal"> & {
    onAgentToolResult?: NonNullable<CopilotToolBridgeInput["attemptParams"]>["onAgentToolResult"];
    observeToolTerminal?: NonNullable<
      CopilotToolBridgeInput["attemptParams"]
    >["observeToolTerminal"];
  };

export async function convertBranchToolToSdkToolForTest(
  sourceTool: AnyAgentTool,
  options: ConvertToolOptions,
): Promise<SdkTool> {
  const bridge = await createCopilotToolBridge({
    abortSignal: options.abortSignal,
    allowModelTools: true,
    attemptParams: {
      // Conversion targets the direct SDK handler; default Tool Search would catalog the tool.
      config: { tools: { toolSearch: false } },
      ...(options.onAgentToolResult ? { onAgentToolResult: options.onAgentToolResult } : {}),
      ...(options.observeToolTerminal ? { observeToolTerminal: options.observeToolTerminal } : {}),
    },
    createBranchCodingTools: () => [sourceTool],
    modelId: "gpt-test",
    onToolCompleted: options.onToolCompleted,
  });
  return expectDefined(bridge.promptToolPolicy.apply().tools[0], "Copilot SDK tool");
}

export function makeInvocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    arguments: { value: "input" },
    sessionId: "session-1",
    toolCallId: "call-1",
    toolName: "tool-a",
    ...overrides,
  };
}

export function runSdkTool(tool: SdkTool, args: unknown, invocation = makeInvocation()) {
  if (!tool.handler) {
    throw new Error(`SDK tool '${tool.name}' has no handler`);
  }
  return tool.handler(args, invocation);
}
