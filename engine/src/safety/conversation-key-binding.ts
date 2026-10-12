// microsoft/UFO@a795552d976c4c019d7c2f778a0effb5cef7de6b:ufo/server/services/client_connection_manager.py,
// ufo/server/services/session_manager.py (atlas SAFETY-0182; owner requests G-1604, G-1591 under SAFETY-0194).
// Branch keeps UFO's rules: identity is bound when the connection registers, never taken from a later frame;
// a live id cannot be registered twice; a session belongs to its creator and lookups never create one.

export type ConnectionRole = "operator" | "node" | "agent";

export type KeyBinding = Readonly<{ keyId: string; conversationKey: string; deviceId: string }>;

export type BindingRefusal =
  | "unregistered"
  | "duplicate-client"
  | "spoofed-client"
  | "spoofed-role"
  | "other-conversation"
  | "other-device"
  | "session-owned-by-other"
  | "not-executor";

export type BindingDecision = { ok: true } | { ok: false; reason: BindingRefusal };

const ok: BindingDecision = { ok: true };
const refuse = (reason: BindingRefusal): BindingDecision => ({ ok: false, reason });

type Registered = { clientId: string; role: ConnectionRole; binding?: KeyBinding };

/** One registry per engine: connection identity, conversation-bound keys and session ownership. */
export class ConnectionBindingRegistry {
  private readonly byConnection = new Map<string, Registered>();
  private readonly liveClients = new Map<string, string>();
  private readonly sessionOwners = new Map<string, string>();
  private readonly resultSenders = new Map<string, string>();

  /** Bind identity at registration. A client id already live on another connection is refused. */
  register(connId: string, entry: Registered): BindingDecision {
    const holder = this.liveClients.get(entry.clientId);
    if (holder !== undefined && holder !== connId) {
      return refuse("duplicate-client");
    }
    this.byConnection.set(connId, { ...entry });
    this.liveClients.set(entry.clientId, connId);
    return ok;
  }

  remove(connId: string): void {
    const entry = this.byConnection.get(connId);
    if (entry && this.liveClients.get(entry.clientId) === connId) {
      this.liveClients.delete(entry.clientId);
    }
    this.byConnection.delete(connId);
  }

  /** Check a frame's claims against what the connection registered as. Wire claims never widen it. */
  checkClaim(connId: string, claim: { clientId?: string; role?: ConnectionRole }): BindingDecision {
    const entry = this.byConnection.get(connId);
    if (!entry) {
      return refuse("unregistered");
    }
    if (claim.clientId !== undefined && claim.clientId !== entry.clientId) {
      return refuse("spoofed-client");
    }
    if (claim.role !== undefined && claim.role !== entry.role) {
      return refuse("spoofed-role");
    }
    return ok;
  }

  /** G-1604: a conversation-bound key acts only in its own conversation, through every route. */
  checkTarget(connId: string, target: { conversationKey?: string; deviceId?: string }): BindingDecision {
    const entry = this.byConnection.get(connId);
    if (!entry) {
      return refuse("unregistered");
    }
    return checkKeyBinding(entry.binding, target);
  }

  /** The first creator owns a session id; another client re-using it is refused. */
  claimSession(connId: string, sessionId: string): BindingDecision {
    const entry = this.byConnection.get(connId);
    if (!entry) {
      return refuse("unregistered");
    }
    const owner = this.sessionOwners.get(sessionId);
    if (owner !== undefined && owner !== entry.clientId) {
      return refuse("session-owned-by-other");
    }
    this.sessionOwners.set(sessionId, entry.clientId);
    return ok;
  }

  /** Lookup only: never creates or claims. */
  sessionOwner(sessionId: string): string | undefined {
    return this.sessionOwners.get(sessionId);
  }

  bindResultSender(sessionId: string, executorClientId: string): void {
    this.resultSenders.set(sessionId, executorClientId);
  }

  /** Only the registered executor may return results for a session. */
  checkResultSender(connId: string, sessionId: string): BindingDecision {
    const entry = this.byConnection.get(connId);
    if (!entry) {
      return refuse("unregistered");
    }
    return this.resultSenders.get(sessionId) === entry.clientId ? ok : refuse("not-executor");
  }

  /** Completed sessions are dropped so their results cannot be replayed to a later peer. */
  removeSession(sessionId: string): void {
    this.sessionOwners.delete(sessionId);
    this.resultSenders.delete(sessionId);
  }

  get sessionCount(): number {
    return this.sessionOwners.size;
  }
}

/** G-1604 and G-1591 without a registry: a bound key targets only its conversation and its device. */
export function checkKeyBinding(
  binding: KeyBinding | undefined,
  target: { conversationKey?: string; deviceId?: string },
): BindingDecision {
  if (!binding) {
    return ok;
  }
  if (target.conversationKey !== binding.conversationKey) {
    return refuse("other-conversation");
  }
  if (target.deviceId !== undefined && target.deviceId !== binding.deviceId) {
    return refuse("other-device");
  }
  return ok;
}

/**
 * G-1591: device picks are per caller. An explicit pick must be one of the caller's own devices; with no pick,
 * only the caller's own devices are candidates, never another caller's.
 */
export function pickCallerDevice(params: {
  callerId: string;
  requestedDeviceId?: string;
  devices: ReadonlyArray<{ deviceId: string; ownerId: string; connected: boolean }>;
}): { ok: true; deviceId: string } | { ok: false; reason: "other-callers-device" | "no-device" } {
  const own = params.devices.filter((device) => device.ownerId === params.callerId);
  if (params.requestedDeviceId !== undefined) {
    return own.some((device) => device.deviceId === params.requestedDeviceId)
      ? { ok: true, deviceId: params.requestedDeviceId }
      : { ok: false, reason: "other-callers-device" };
  }
  const connected = own.find((device) => device.connected);
  return connected ? { ok: true, deviceId: connected.deviceId } : { ok: false, reason: "no-device" };
}
