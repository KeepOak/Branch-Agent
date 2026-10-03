import type { BranchConfig } from "../../config/types.branch.js";
import type { DeliveryContext } from "../../utils/delivery-context.types.js";
import type { AgentToolGatewayRequestCaller } from "./in-process-gateway.js";

export type SessionsSendToolOptions = {
  workerPlacement?: boolean;
  agentId?: string;
  agentSessionKey?: string;
  agentSessionId?: string;
  requesterTurnRunId?: string;
  agentChannel?: string;
  requesterOrigin?: DeliveryContext;
  sandboxed?: boolean;
  config?: BranchConfig;
  callGateway?: AgentToolGatewayRequestCaller;
  /** Backend-derived target incarnation; never sourced from model arguments. */
  expectedTargetSessionId?: string;
  expectedTargetStorePath?: string;
  /** Backend-owned downstream operation id; never sourced from model arguments. */
  idempotencyKey?: string;
  signal?: AbortSignal;
};
