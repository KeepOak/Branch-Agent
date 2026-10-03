// The moving-face cap (DESIGN-SPEC §6.7; owner decision Q20): at most 12 pebbles and 6 character videos play
// an action at once. Priority: (1) the open conversation's Trunk, (2) Trunks working or "Waiting for you",
// (3) the rows nearest the top. A face that loses its slot goes back to its still. The cap is the old app's
// (core/pebble.js LIVE_MAX = 12, core/figures.js at most six), written fresh here.

export type FaceKind = "pebble" | "video";
export const CAP: Record<FaceKind, number> = { pebble: 12, video: 6 };

/** Higher plays first. */
export const PRIORITY = { open: 300, active: 200, row: 100 } as const;

type Holder = { id: number; kind: FaceKind; priority: number; revoke: () => void };

export class FaceCap {
  private readonly holders = new Map<number, Holder>();

  private readonly limits: Record<FaceKind, number>;

  constructor(limits: Record<FaceKind, number> = CAP) {
    this.limits = limits;
  }

  /** Asks for a slot; true when the face may play. A lower-priority holder may be sent back to its still. */
  request(id: number, kind: FaceKind, priority: number, revoke: () => void): boolean {
    const mine = this.holders.get(id);
    if (mine) {
      mine.priority = priority;
      mine.revoke = revoke;
      return true;
    }
    const same = [...this.holders.values()].filter((h) => h.kind === kind);
    if (same.length >= this.limits[kind]) {
      const weakest = same.reduce((a, b) => (b.priority < a.priority ? b : a));
      if (weakest.priority >= priority) {
        return false;
      }
      this.holders.delete(weakest.id);
      weakest.revoke();
    }
    this.holders.set(id, { id, kind, priority, revoke });
    return true;
  }

  release(id: number): void {
    this.holders.delete(id);
  }

  playing(kind: FaceKind): number {
    return [...this.holders.values()].filter((h) => h.kind === kind).length;
  }
}

/** The one cap the whole window shares. */
export const faceCap = new FaceCap();
