import { hasMultipleSessionSharingIdentities } from "../state/user-profile-list.js";
import type { BranchToolsOptions } from "./branch-tools.types.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createBranchDelegateToolsForRun } from "./tools/branch-delegate-tool.js";
import { createPersonalInstructionsTool } from "./tools/personal-instructions-tool.js";
import { createPluginsTool } from "./tools/plugins-tool.js";
import { createPresenceTool } from "./tools/presence-tool.js";

/** Gateway-owned operations are not standalone embedded-host capabilities. */
export function createHostedGatewayTools(
  embedded: boolean,
  sessionAgentId: string,
  options?: BranchToolsOptions,
): AnyAgentTool[] {
  if (embedded) {
    return [];
  }
  return [
    createPresenceTool({ runId: options?.runId }),
    createGatewayTool({
      allowConfigReads: options?.gatewayConfigReadAllowed === true,
      senderIsOwner: options?.senderIsOwner,
      requesterSenderId: options?.requesterSenderId,
    }),
    createPluginsTool(),
    ...createBranchDelegateToolsForRun({ ...options, sessionAgentId }),
    ...(hasMultipleSessionSharingIdentities()
      ? [createPersonalInstructionsTool(sessionAgentId)]
      : []),
  ];
}
