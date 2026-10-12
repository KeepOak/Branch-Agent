import type { EmbeddedRunAttemptParamsV2 as EmbeddedRunAttemptParams } from "branch/plugin-sdk/agent-harness-runtime";

export function setAgentWorkspaceForTest(
  params: EmbeddedRunAttemptParams,
  workspaceDir: string,
): void {
  params.config = {
    ...params.config,
    agents: {
      ...params.config?.agents,
      defaults: {
        ...params.config?.agents?.defaults,
        workspace: workspaceDir,
      },
    },
  };
}
