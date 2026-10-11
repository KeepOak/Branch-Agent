// Gateway wizard session tracker.
// Tracks active setup/onboarding wizard sessions and purges completed ones.
import type { WizardSession } from "../wizard/session.js";
import type { GatewayClient } from "./server-methods/client-types.js";

const loginOwners = new WeakMap<WizardSession, GatewayClient>();

/** A view-owned wizard closes input when its connection disappears. */
export function bindWizardLoginOwner(session: WizardSession, client: GatewayClient): void {
  loginOwners.set(session, client);
  const close = () => session.close(new Error("Setup connection closed."));
  client.connectionSignal?.addEventListener("abort", close, { once: true });
  if (client.invalidated || client.connectionSignal?.aborted) {
    close();
  }
  void session
    .whenSettled()
    .finally(() => client.connectionSignal?.removeEventListener("abort", close));
}

export function canAccessWizardSession(
  session: WizardSession,
  client: GatewayClient | null,
): boolean {
  const owner = loginOwners.get(session);
  return !owner || (owner === client && !owner.invalidated && !owner.connectionSignal?.aborted);
}

/** Recovery exposes no prompts and is limited to the same authenticated owner. */
export function canCancelOwnedWizardSession(
  session: WizardSession,
  client: GatewayClient | null,
): boolean {
  if (
    !client ||
    client.invalidated ||
    client.connectionSignal?.aborted ||
    !client.connect.scopes?.includes("operator.admin")
  ) {
    return false;
  }
  const owner = loginOwners.get(session);
  if (!owner || owner === client) {
    return true;
  }
  if (
    client.internal?.operatorRoleActor?.kind === "system" &&
    owner.internal?.operatorRoleActor?.kind === "system"
  ) {
    return true;
  }
  if (client.authenticatedUserId || owner.authenticatedUserId) {
    return Boolean(
      client.authenticatedUserId && client.authenticatedUserId === owner.authenticatedUserId,
    );
  }
  return Boolean(
    client.connect.device?.id && client.connect.device.id === owner.connect.device?.id,
  );
}

const UNCOLLECTED_TERMINAL_RETENTION_MS = 5 * 60 * 1000;

/** Creates the in-memory tracker used for active Gateway wizard sessions. */
export function createWizardSessionTracker(options?: { now?: () => number }) {
  const wizardSessions = new Map<string, WizardSession>();
  const terminalSince = new Map<string, number>();
  const now = options?.now ?? Date.now;

  const findRunningWizard = (): string | null => {
    for (const [id, session] of wizardSessions) {
      if (!session.isSettled()) {
        terminalSince.delete(id);
        return id;
      }
      const observedAt = terminalSince.get(id);
      if (observedAt === undefined) {
        terminalSince.set(id, now());
      } else if (now() - observedAt >= UNCOLLECTED_TERMINAL_RETENTION_MS) {
        // Keep a terminal result long enough for its original client to collect
        // it; later starts may reap only an abandoned retained result.
        wizardSessions.delete(id);
        terminalSince.delete(id);
      }
    }
    return null;
  };

  const purgeWizardSession = (id: string) => {
    const session = wizardSessions.get(id);
    if (!session) {
      return;
    }
    if (!session.isSettled()) {
      return;
    }
    wizardSessions.delete(id);
    terminalSince.delete(id);
  };

  return { wizardSessions, findRunningWizard, purgeWizardSession };
}
