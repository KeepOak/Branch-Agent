import { randomUUID } from "node:crypto";

/**
 * Consent on the watched computer. A peer asks to watch; nothing is captured until the local user answers the
 * prompt. "Always" is remembered per link (peer device plus its pairing generation), so re-pairing asks again.
 * Control is a separate grant and is not part of this ledger.
 */
export type WatchDecision = "allow-once" | "allow-always" | "deny";

export type WatchSession = {
  id: string;
  peerDeviceId: string;
  pairingGeneration: string;
  state: "pending" | "active";
  grant?: "once" | "always";
  requestedAtMs: number;
};

export type WatchRequestInput = {
  peerDeviceId: string;
  pairingGeneration: string;
  nowMs: number;
};

const linkKey = (peerDeviceId: string, pairingGeneration: string) =>
  `${peerDeviceId}\u0000${pairingGeneration}`;

export class ScreenWatchConsent {
  private readonly sessions = new Map<string, WatchSession>();
  private readonly alwaysLinks = new Set<string>();

  /**
   * Opens a watch for this link. Asking again while one is open returns it, so a retry never shows a second
   * prompt. A remembered "always" grant starts the watch active without a prompt.
   */
  request(input: WatchRequestInput): WatchSession {
    const open = this.findLinkSession(input.peerDeviceId, input.pairingGeneration);
    if (open) {
      return open;
    }
    const remembered = this.alwaysLinks.has(linkKey(input.peerDeviceId, input.pairingGeneration));
    const session: WatchSession = {
      id: randomUUID(),
      peerDeviceId: input.peerDeviceId,
      pairingGeneration: input.pairingGeneration,
      state: remembered ? "active" : "pending",
      ...(remembered ? { grant: "always" as const } : {}),
      requestedAtMs: input.nowMs,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  /** Answers the prompt. Only a pending watch can be decided; an answer is final for that session. */
  decide(sessionId: string, decision: WatchDecision): WatchSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "pending") {
      return undefined;
    }
    if (decision === "deny") {
      this.sessions.delete(sessionId);
      return undefined;
    }
    if (decision === "allow-always") {
      this.alwaysLinks.add(linkKey(session.peerDeviceId, session.pairingGeneration));
    }
    session.state = "active";
    session.grant = decision === "allow-always" ? "always" : "once";
    return { ...session };
  }

  /** The prompts waiting for the local user, oldest first. */
  pending(): WatchSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.state === "pending")
      .toSorted((a, b) => a.requestedAtMs - b.requestedAtMs)
      .map((session) => Object.assign({}, session));
  }

  /** True only for an active watch bound to this exact peer and pairing generation. */
  isActive(sessionId: string, peerDeviceId: string, pairingGeneration: string): boolean {
    const session = this.sessions.get(sessionId);
    return (
      session !== undefined &&
      session.state === "active" &&
      session.peerDeviceId === peerDeviceId &&
      session.pairingGeneration === pairingGeneration
    );
  }

  /** Ends one watch: the user pressed Stop, the peer left, or the watch went stale. */
  end(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /** Ends every watch and forgets "always" for this peer. Used when its pairing is removed. */
  revokePeer(peerDeviceId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.peerDeviceId === peerDeviceId) {
        this.sessions.delete(id);
      }
    }
    for (const key of this.alwaysLinks) {
      if (key.startsWith(`${peerDeviceId}\u0000`)) {
        this.alwaysLinks.delete(key);
      }
    }
  }

  /** Lockdown turned on: every watch ends. "Always" grants stay, so they still apply once Lockdown is off. */
  endAll(): void {
    this.sessions.clear();
  }

  private findLinkSession(peerDeviceId: string, pairingGeneration: string): WatchSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.peerDeviceId === peerDeviceId && session.pairingGeneration === pairingGeneration) {
        return { ...session };
      }
    }
    return undefined;
  }
}
