import { AsyncLocalStorage } from "node:async_hooks";

/** The requesting Trunk's posture; agent-made model changes are decided by tools.modelChoice. */
export type AgentModelPatchAccess = { fullAccess: boolean };

const agentSessionModelPatch = new AsyncLocalStorage<
  | { kind: "agent"; access: AgentModelPatchAccess }
  | { kind: "session-status"; applied: boolean; access: AgentModelPatchAccess }
>();

export function withAgentSessionModelPatchOrigin<T>(
  run: () => T,
  access: AgentModelPatchAccess = { fullAccess: false },
): T {
  return agentSessionModelPatch.run({ kind: "agent", access }, run);
}

export async function withSessionStatusModelPatchOrigin<T>(
  run: () => Promise<T>,
  access: AgentModelPatchAccess = { fullAccess: false },
): Promise<{ result: T; applied: boolean }> {
  const origin = { kind: "session-status" as const, applied: false, access };
  const result = await agentSessionModelPatch.run(origin, run);
  return { result, applied: origin.applied };
}

export function isAgentSessionModelPatchOrigin(): boolean {
  return agentSessionModelPatch.getStore()?.kind === "agent";
}

/** Status selections remain per-session and do not establish an automatic fallback. */
export function isSessionStatusModelPatchOrigin(): boolean {
  return agentSessionModelPatch.getStore()?.kind === "session-status";
}

/** Present only for model changes an agent tool made; absent for people's own changes. */
export function readAgentModelPatchAccess(): AgentModelPatchAccess | undefined {
  return agentSessionModelPatch.getStore()?.access;
}

/** Only the mutation owner records whether the scoped selection committed a change. */
export function recordSessionStatusModelPatchOutcome(applied: boolean): void {
  const origin = agentSessionModelPatch.getStore();
  if (origin?.kind === "session-status") {
    origin.applied ||= applied;
  }
}
