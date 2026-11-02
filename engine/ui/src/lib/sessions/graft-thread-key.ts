// Graft's trunk_send opens new threads as `agent:<trunk>:<caller>-<epoch ms>` (engine/src/mcp/trunk-tools.ts).
const GRAFT_THREAD_KEY_RE = /^agent:[^:]+:[a-z0-9]+(?:-[a-z0-9]+)*-\d{13}$/u;

/** True for a thread another agent started through Graft, not one a person opened. */
export function isGraftThreadKey(key: string): boolean {
  return GRAFT_THREAD_KEY_RE.test(key);
}
