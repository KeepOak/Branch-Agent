import { existsSync } from "node:fs";
import path from "node:path";
import type { DesktopRestartReceipt } from "../../packages/gateway-protocol/src/schema/desktop-restart.js";
import { resolveStateDir } from "../config/paths.js";
import type { AgentTurnPrincipal } from "./agent-turn/types.js";
import { DesktopRestartReceiptStore } from "./desktop-restart-receipts.js";
import type { GatewayClient } from "./server-methods/types.js";

type Binding = {
  client: GatewayClient;
  receipt: DesktopRestartReceipt;
  canonicalKey: string;
  lifecycleRevision: string | null;
  assertCurrent: () => void;
  accept: (runId: string) => void;
};
const requests = new WeakMap<object, Binding>();

/** In-process request capability, never transport data or a modified client mode.
 * Its only added permission is a restrictive exact existing-session precondition. */
export async function withDesktopRestartAdmission<T>(
  request: object,
  binding: Binding,
  run: () => Promise<T>,
): Promise<T> {
  if (requests.has(request)) throw new Error("Desktop restart request capability already owned");
  requests.set(request, binding);
  try {
    return await run();
  } finally {
    requests.delete(request);
  }
}
export function hasDesktopRestartExpectedSession(
  request: object,
  client: AgentTurnPrincipal | null,
): boolean {
  const binding = requests.get(request);
  if (!binding || client?.connect !== binding.client.connect) return false;
  const fields = request as Record<string, unknown>;
  if (
    fields.sessionKey !== binding.canonicalKey ||
    fields.expectedExistingSessionId !== binding.receipt.expectedSessionId ||
    fields.expectedExistingSessionLifecycleRevision !== binding.lifecycleRevision ||
    fields.idempotencyKey !== `desktop-restart:${binding.receipt.id}` ||
    fields.internalRuntimeHandoffId !== undefined
  )
    return false;
  binding.assertCurrent();
  return true;
}
/** Called only by canonical admission AFTER approved input custody and final
 * normal operator/session checks, synchronously BEFORE accepting the run. */
export function commitDesktopRestartAdmission(
  request: object,
  client: AgentTurnPrincipal | null,
  target: { runId: string; sessionKey?: string; sessionId: string },
): void {
  const binding = requests.get(request);
  if (!binding) return;
  if (
    !hasDesktopRestartExpectedSession(request, client) ||
    target.runId !== `desktop-restart:${binding.receipt.id}` ||
    target.sessionKey !== binding.canonicalKey ||
    target.sessionId !== binding.receipt.expectedSessionId
  ) {
    throw new Error("Desktop restart canonical admission binding mismatch");
  }
  binding.assertCurrent();
  binding.accept(target.runId);
}

/** Existing canonical recovery supplies admitted source lineage, never requester proof.
 * The eventual read still reauthorizes the original UI subject. */
export function recordDesktopCanonicalRecoveryAdmission(target: {
  sessionKey: string;
  sessionId: string;
  lifecycleRevision: string | null;
  sourceRunIds: readonly string[];
  runId: string;
}): void {
  if (!target.sourceRunIds.length) return;
  const file = path.join(resolveStateDir(), "desktop-restart-receipts.sqlite");
  if (!existsSync(file)) return;
  const store = new DesktopRestartReceiptStore(file);
  try {
    store.recordCanonicalAdmission(target);
  } finally {
    store.close();
  }
}
