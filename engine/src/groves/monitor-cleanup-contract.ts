import { z } from "zod";

const text = z.string().min(1).max(4096);
export const groveMonitorCleanupBindingSchema = z
  .object({
    configPath: text,
    statePath: text,
    cronStorePath: text,
  })
  .strict();
export type GroveMonitorCleanupBinding = z.infer<typeof groveMonitorCleanupBindingSchema>;
export const groveMonitorSnapshotSchema = z
  .object({
    id: text,
    name: z.string(),
    enabled: z.boolean(),
    agentId: text,
    ownerAgentId: z.null(),
    storeKey: text,
    declarationKey: text,
    revision: text,
  })
  .strict();
export const groveMonitorInventorySchema = z
  .object({
    monitors: z.array(groveMonitorSnapshotSchema).max(2),
  })
  .strict();
export type GroveMonitorSnapshot = z.infer<typeof groveMonitorSnapshotSchema>;
export const groveMonitorDrainSchema = z.object({ drained: z.literal(true) }).strict();

export type GroveMonitorCleanupGateway = {
  inspect: (agentId: string) => Promise<GroveMonitorSnapshot[]>;
  quiesce: (agentId: string, operationId: string, monitors: GroveMonitorSnapshot[]) => Promise<void>;
  drain: (agentId: string, operationId: string) => Promise<void>;
};
