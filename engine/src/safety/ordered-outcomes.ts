// Ordered outcomes and fenced leases: a stale completion or a stale claimant never overrides newer work
// (atlas SAFETY-0193: G-1669, G-1670, G-1453). Leases coordinate at least once; they do not make external
// effects exactly once.

export type OrderedOutcome<T> = Readonly<{ sequence: number; outcome: T }>;

/** Keeps the outcome of the newest started attempt per key, whatever order completions arrive in. */
export class OrderedOutcomeLog<T> {
  private readonly latest = new Map<string, OrderedOutcome<T>>();

  /** Returns false (and keeps the newer record) when a completion from an older attempt arrives late. */
  record(key: string, sequence: number, outcome: T): boolean {
    const current = this.latest.get(key);
    if (current && current.sequence > sequence) {
      return false;
    }
    this.latest.set(key, Object.freeze({ sequence, outcome }));
    return true;
  }

  get(key: string): OrderedOutcome<T> | undefined {
    return this.latest.get(key);
  }
}

export type LeaseClaim = Readonly<{
  key: string;
  holder: string;
  token: number;
  expiresAt: number;
}>;

/** Distributed job leases with fencing tokens: every claim gets a larger token; only the current one may act. */
export class FencedLeaseTable {
  private nextToken = 0;
  private readonly claims = new Map<string, LeaseClaim>();

  claim(key: string, holder: string, ttlMs: number, now: number): LeaseClaim | undefined {
    const current = this.claims.get(key);
    if (current && current.expiresAt > now && current.holder !== holder) {
      return undefined;
    }
    this.nextToken += 1;
    const claim = Object.freeze({ key, holder, token: this.nextToken, expiresAt: now + ttlMs });
    this.claims.set(key, claim);
    return claim;
  }

  /** True only for the newest, unexpired claim. A stale claimant's token never passes. */
  mayAct(key: string, token: number, now: number): boolean {
    const current = this.claims.get(key);
    return current !== undefined && current.token === token && current.expiresAt > now;
  }

  release(key: string, token: number): boolean {
    if (this.claims.get(key)?.token !== token) {
      return false;
    }
    this.claims.delete(key);
    return true;
  }
}

/** Consecutive-failure counter fed by out-of-order deliveries: only results newer than the last one count. */
export class OrderedFailureCounter {
  private lastSequence = -Infinity;
  private failures = 0;

  record(sequence: number, ok: boolean): number {
    if (sequence <= this.lastSequence) {
      return this.failures;
    }
    this.lastSequence = sequence;
    this.failures = ok ? 0 : this.failures + 1;
    return this.failures;
  }

  get count(): number {
    return this.failures;
  }
}
