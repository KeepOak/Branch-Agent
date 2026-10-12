import type { SessionRow } from "@branch/gateway-protocol";

export type { AgentsListResult } from "@branch/gateway-protocol";
export type GatewaySessionRow = SessionRow & {
  hasActiveRun?: boolean;
  abortedLastRun?: boolean;
};
