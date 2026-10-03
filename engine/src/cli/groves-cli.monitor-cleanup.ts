import { resolveGroveMonitorCleanupBinding } from "../groves/monitor-cleanup-binding.js";
import {
  groveMonitorInventorySchema,
  groveMonitorDrainSchema,
  type GroveMonitorCleanupGateway,
} from "../groves/monitor-cleanup-contract.js";
import { getRuntimeConfig } from "../config/config.js";
import { resolveCronJobsStorePathFromConfig } from "../cron/store.js";
import { callGatewayFromCli } from "./gateway-rpc.js";

const binding = () =>
  resolveGroveMonitorCleanupBinding(resolveCronJobsStorePathFromConfig(getRuntimeConfig()));

export const groveMonitorCleanupGateway: GroveMonitorCleanupGateway = {
  inspect: async (agentId) =>
    groveMonitorInventorySchema.parse(
      await callGatewayFromCli(
        "groves.monitors",
        { timeout: "5000" },
        { phase: "inspect", agentId, binding: binding() },
      ),
    ).monitors,
  quiesce: async (agentId, operationId, monitors) => {
    groveMonitorDrainSchema.parse(
      await callGatewayFromCli(
        "groves.monitors",
        {},
        { phase: "quiesce", agentId, operationId, monitors, binding: binding() },
      ),
    );
  },
  drain: async (agentId, operationId) => {
    groveMonitorDrainSchema.parse(
      await callGatewayFromCli(
        "groves.monitors",
        {},
        { phase: "drain", agentId, operationId, binding: binding() },
      ),
    );
  },
};
