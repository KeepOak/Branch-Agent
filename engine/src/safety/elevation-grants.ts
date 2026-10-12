// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/trust/services/ContextualPermissionSystem.ts
// (atlas SAFETY-0165). Eliza's time-boxed elevation: a default of 5 minutes, admin-level actions are never granted
// by elevation, expired grants are pruned on read. Branch keeps those defaults and swaps eliza's trust score for
// the existing elevated allowlist (auto-reply/reply/reply-elevated.ts). The owner is never time-boxed.

/** Eliza's default elevation window: `(request.duration ?? 5 * 60) * 1000`. */
export const ELEVATION_DEFAULT_DURATION_SECONDS = 5 * 60;

/** Eliza's ADMIN_ONLY_ACTIONS, under Branch's names: changing who may do what, or settings, never by elevation. */
export const ELEVATION_ADMIN_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  "manage_roles",
  "manage_settings",
  "manage_channels",
  "ban_user",
  "delete_content",
]);

export type ElevationRequest = Readonly<{
  requesterId: string;
  action: string;
  /** Seconds; eliza's default when absent. */
  duration?: number;
  isOwner: boolean;
  /** The requester is on the elevated allowlist for this channel (reply-elevated.ts decides). */
  allowlisted: boolean;
}>;

export type ElevationResult =
  | { granted: true; expiresAt: number | null }
  | { granted: false; reason: "admin-only" | "not-allowlisted" };

type Grant = { requesterId: string; action: string; expiresAt: number | null };

export class ElevationGrants {
  private readonly grants = new Map<string, Grant>();

  constructor(private readonly now: () => number = Date.now) {}

  request(request: ElevationRequest): ElevationResult {
    if (!request.isOwner && ELEVATION_ADMIN_ONLY_ACTIONS.has(request.action)) {
      return { granted: false, reason: "admin-only" };
    }
    if (!request.isOwner && !request.allowlisted) {
      return { granted: false, reason: "not-allowlisted" };
    }
    const expiresAt = request.isOwner
      ? null
      : this.now() + (request.duration ?? ELEVATION_DEFAULT_DURATION_SECONDS) * 1000;
    this.grants.set(`${request.requesterId}\u0000${request.action}`, {
      requesterId: request.requesterId,
      action: request.action,
      expiresAt,
    });
    return { granted: true, expiresAt };
  }

  /** Active, non-expired grant for exactly this requester and action. Expired grants are pruned here. */
  isElevated(requesterId: string, action: string): boolean {
    for (const [key, grant] of this.grants) {
      if (grant.expiresAt !== null && grant.expiresAt < this.now()) {
        this.grants.delete(key);
        continue;
      }
      if (grant.requesterId === requesterId && grant.action === action) {
        return true;
      }
    }
    return false;
  }

  revoke(requesterId: string): void {
    for (const [key, grant] of this.grants) {
      if (grant.requesterId === requesterId) {
        this.grants.delete(key);
      }
    }
  }
}
