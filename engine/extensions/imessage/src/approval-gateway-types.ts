import type { resolveApprovalOverGateway } from "branch/plugin-sdk/approval-gateway-runtime";

export type IMessageApprovalGatewayRuntime = NonNullable<
  Parameters<typeof resolveApprovalOverGateway>[0]["gatewayRuntime"]
>;
