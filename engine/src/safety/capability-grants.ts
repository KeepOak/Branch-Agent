// Branch-original shared safety piece (atlas SAFETY-0194, G-1620 and G-1711): one-use, expiring, memory-only
// grants for sensitive viewing sessions and phone-capability lending. Same shape as the board view ticket
// (gateway/board-view-ticket.ts): bound claims, short life, checked on every use.
import { randomBytes } from "node:crypto";

export type ViewingPurpose = "screen-share" | "watch-browser" | "watch-desktop";
export type PhonePurpose =
  | "phone-camera"
  | "phone-location"
  | "phone-notifications-read"
  | "phone-notifications-act";
export type GrantPurpose = ViewingPurpose | PhonePurpose;

export type GrantBinding = Readonly<{
  ownerId: string;
  profileId: string;
  deviceId: string;
  conversationKey?: string;
  /** Phone lending: the paired phone key and the exact action. */
  phoneKeyId?: string;
  action?: string;
}>;

export type GrantRevokeReason = "stop" | "profile-switch" | "lockdown" | "lock" | "expired" | "idle";

export type GrantRefusal =
  | "app-locked"
  | "stale-confirmation"
  | "not-local-owner"
  | "phone-not-opted-in"
  | "missing-binding"
  | "unknown"
  | "wrong-purpose"
  | "wrong-binding"
  | "used"
  | GrantRevokeReason;

export const GRANT_TTL_MS = 5 * 60_000;
export const GRANT_IDLE_MS = 60_000;
export const OWNER_CONFIRMATION_MAX_AGE_MS = 30_000;

type Grant = {
  purpose: GrantPurpose;
  binding: GrantBinding;
  expiresAt: number;
  idleAt: number;
  oneUse: boolean;
  used: boolean;
  revoked?: GrantRevokeReason;
};

export type IssueRequest = {
  purpose: GrantPurpose;
  binding: GrantBinding;
  /** When the owner confirmed this exact grant. Confirming never unlocks the app. */
  ownerConfirmedAt: number;
  appLocked: boolean;
  /** Phone lending is granted by the owner at this computer only. */
  localOwner: boolean;
  /** Reading or acting on notifications also needs the phone's own opt-in. */
  phoneOptedIn?: boolean;
};

const NOTIFICATION_PURPOSES = new Set<GrantPurpose>(["phone-notifications-read", "phone-notifications-act"]);
const isPhone = (purpose: GrantPurpose): purpose is PhonePurpose => purpose.startsWith("phone-");

type Result<T> = { ok: true; value: T } | { ok: false; reason: GrantRefusal };
const fail = <T>(reason: GrantRefusal): Result<T> => ({ ok: false, reason });

function issueRefusal(request: IssueRequest, now: number): GrantRefusal | undefined {
  if (request.appLocked) {
    return "app-locked";
  }
  if (now - request.ownerConfirmedAt > OWNER_CONFIRMATION_MAX_AGE_MS || request.ownerConfirmedAt > now) {
    return "stale-confirmation";
  }
  if (isPhone(request.purpose)) {
    if (!request.localOwner) {
      return "not-local-owner";
    }
    if (!request.binding.phoneKeyId || !request.binding.action) {
      return "missing-binding";
    }
    if (NOTIFICATION_PURPOSES.has(request.purpose) && request.phoneOptedIn !== true) {
      return "phone-not-opted-in";
    }
  }
  return undefined;
}

function sameBinding(a: GrantBinding, b: GrantBinding): boolean {
  return (
    a.ownerId === b.ownerId &&
    a.profileId === b.profileId &&
    a.deviceId === b.deviceId &&
    a.conversationKey === b.conversationKey &&
    a.phoneKeyId === b.phoneKeyId &&
    a.action === b.action
  );
}

/** Grants live only in this process: a restart drops every one of them. */
export class CapabilityGrantStore {
  private readonly grants = new Map<string, Grant>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Issue a purpose-only grant. Acting on notifications is a single-use ticket. */
  issue(request: IssueRequest): Result<{ token: string; expiresAt: number }> {
    const now = this.now();
    const refusal = issueRefusal(request, now);
    if (refusal) {
      return fail(refusal);
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = now + GRANT_TTL_MS;
    this.grants.set(token, {
      purpose: request.purpose,
      binding: { ...request.binding },
      expiresAt,
      idleAt: now + GRANT_IDLE_MS,
      oneUse: request.purpose === "phone-notifications-act",
      used: false,
    });
    return { ok: true, value: { token, expiresAt } };
  }

  /** Re-check around each capture or action. Only owner activity renews the idle timer. */
  check(
    token: string,
    use: { purpose: GrantPurpose; binding: GrantBinding; activity?: "owner-input" | "captured-output" },
  ): Result<GrantPurpose> {
    const grant = this.grants.get(token);
    if (!grant) {
      return fail("unknown");
    }
    const refusal = this.useRefusal(grant, use);
    if (refusal) {
      return fail(refusal);
    }
    if (use.activity === "owner-input") {
      grant.idleAt = this.now() + GRANT_IDLE_MS;
    }
    if (grant.oneUse) {
      grant.used = true;
    }
    return { ok: true, value: grant.purpose };
  }

  private useRefusal(grant: Grant, use: { purpose: GrantPurpose; binding: GrantBinding }): GrantRefusal | undefined {
    const now = this.now();
    if (grant.revoked) {
      return grant.revoked;
    }
    if (now > grant.expiresAt) {
      grant.revoked = "expired";
    } else if (now > grant.idleAt) {
      grant.revoked = "idle";
    }
    if (grant.revoked) {
      return grant.revoked;
    }
    if (grant.purpose !== use.purpose) {
      return "wrong-purpose";
    }
    if (!sameBinding(grant.binding, use.binding)) {
      return "wrong-binding";
    }
    return grant.used ? "used" : undefined;
  }

  /** Stop, a profile switch, Lockdown or App lock revoke every grant (or a profile's grants). */
  revokeAll(reason: GrantRevokeReason, profileId?: string): number {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (!grant.revoked && (profileId === undefined || grant.binding.profileId === profileId)) {
        grant.revoked = reason;
        count += 1;
      }
    }
    return count;
  }
}

/** Grants travel in a header only. A token found in the URL is refused and must not be honoured. */
export const CAPABILITY_GRANT_HEADER = "x-branch-capability-grant";

export function readCapabilityGrant(request: {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  url: string;
}): { ok: true; token: string } | { ok: false; reason: "missing" | "token-in-url" } {
  const query = new URL(request.url, "http://local.invalid").searchParams;
  const header = request.headers[CAPABILITY_GRANT_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  for (const value of query.values()) {
    if (value.length > 0 && value === token) {
      return { ok: false, reason: "token-in-url" };
    }
  }
  if (query.has("grant") || query.has("capabilityGrant")) {
    return { ok: false, reason: "token-in-url" };
  }
  return token ? { ok: true, token } : { ok: false, reason: "missing" };
}
