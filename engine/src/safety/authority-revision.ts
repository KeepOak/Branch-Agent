// Shared safety layer: re-check authority after every await and before every side effect (atlas SAFETY-0193).
// Stage "re-check" of the one decision path (docs/design/notes/safety-layer.md). Revisions only grow, so a
// switch away and back (profile A -> B -> A, lock -> unlock) still reads as changed. Unknown state fails closed.
import { isLockdownOn } from "../config/lockdown.js";

export type AuthorityKind = "owner-profile" | "app-lock" | "config" | "credential-grant" | "policy";

const AUTHORITY_KINDS: readonly AuthorityKind[] = [
  "owner-profile",
  "app-lock",
  "config",
  "credential-grant",
  "policy",
];

/** Thrown when work started under one authority would act under another. Callers stop; they never retry. */
export class StaleAuthorityError extends Error {
  readonly code = "STALE_AUTHORITY";
  constructor(readonly reason: string) {
    super(`Stopped: ${reason}. The work started under settings that have since changed.`);
    this.name = "StaleAuthorityError";
  }
}

export function isStaleAuthorityError(error: unknown): error is StaleAuthorityError {
  return error instanceof StaleAuthorityError;
}

/** Live readings. `undefined` means the state could not be read, which refuses like a change. */
export type AuthoritySource = {
  profileId: () => string | undefined;
  appLocked: () => boolean | undefined;
  lockdown?: () => boolean | undefined;
};

export type AuthoritySnapshot = Readonly<{
  profileId: string;
  revisions: Readonly<Record<AuthorityKind, number>>;
}>;

/** Monotonic revision counters, one per kind of authority. Bump on every change, never reset. */
export class AuthorityRevisions {
  private readonly counters = new Map<AuthorityKind, number>(AUTHORITY_KINDS.map((k) => [k, 0]));

  bump(kind: AuthorityKind): number {
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    return next;
  }

  current(kind: AuthorityKind): number {
    return this.counters.get(kind) ?? 0;
  }

  read(): Record<AuthorityKind, number> {
    const out = {} as Record<AuthorityKind, number>;
    for (const kind of AUTHORITY_KINDS) {
      out[kind] = this.current(kind);
    }
    return out;
  }
}

function readLiveState(source: AuthoritySource): { profileId: string } {
  const profileId = source.profileId();
  if (!profileId) {
    throw new StaleAuthorityError("the owner profile could not be confirmed");
  }
  const locked = source.appLocked();
  if (locked !== false) {
    throw new StaleAuthorityError(locked ? "Branch is locked" : "the lock state could not be read");
  }
  const lockdown = (source.lockdown ?? isLockdownOn)();
  if (lockdown !== false) {
    throw new StaleAuthorityError(
      lockdown ? "Lockdown is on" : "the Lockdown state could not be read",
    );
  }
  return { profileId };
}

/** Take the authority a piece of work starts under. Refuses if it is already locked, locked down or unknown. */
export function captureAuthority(
  revisions: AuthorityRevisions,
  source: AuthoritySource,
): AuthoritySnapshot {
  const { profileId } = readLiveState(source);
  return Object.freeze({ profileId, revisions: Object.freeze(revisions.read()) });
}

/** Call after every await and right before each side effect. Throws StaleAuthorityError on any change. */
export function recheckAuthority(
  revisions: AuthorityRevisions,
  source: AuthoritySource,
  snapshot: AuthoritySnapshot,
): void {
  const { profileId } = readLiveState(source);
  if (profileId !== snapshot.profileId) {
    throw new StaleAuthorityError("the owner profile changed");
  }
  for (const kind of AUTHORITY_KINDS) {
    if (revisions.current(kind) !== snapshot.revisions[kind]) {
      throw new StaleAuthorityError(`${kind} changed`);
    }
  }
}

/** Await one step, then re-check before handing its result on. */
export async function afterAwait<T>(step: Promise<T>, recheck: () => void): Promise<T> {
  const value = await step;
  recheck();
  return value;
}

export type RunTicket = Readonly<{ scope: string; generation: number }>;

/**
 * Run generations: each start takes a new, larger number. A ticket is current only while it is the latest for
 * its scope and newer than the last cancelAll (an app lock), so nothing accepted before a lock ever resumes.
 */
export class RunGenerations {
  private counter = 0;
  private floor = 0;
  private readonly latest = new Map<string, number>();

  begin(scope: string): RunTicket {
    this.counter += 1;
    this.latest.set(scope, this.counter);
    return Object.freeze({ scope, generation: this.counter });
  }

  isCurrent(ticket: RunTicket): boolean {
    return ticket.generation > this.floor && this.latest.get(ticket.scope) === ticket.generation;
  }

  assertCurrent(ticket: RunTicket): void {
    if (!this.isCurrent(ticket)) {
      throw new StaleAuthorityError(
        `run ${ticket.generation} of ${ticket.scope} is no longer current`,
      );
    }
  }

  cancel(scope: string): void {
    this.counter += 1;
    this.latest.set(scope, this.counter);
  }

  /** Locking the app: every pending, in-flight or accepted continuation stops being current. */
  cancelAll(): void {
    this.floor = this.counter;
  }
}
