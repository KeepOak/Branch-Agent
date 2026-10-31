// Who may drive the owner's browser pane for each conversation: the owner's allow, the owner's take-over, and the
// pending question. Held in memory for the life of the window. Each state object is replaced on change, so React can
// read it straight from useSyncExternalStore.
import type { GuestAccess } from "./guest-drive";

export type GuestAccessState = { access: GuestAccess; asking: boolean };

export type GuestAccessStore = {
  state(key: string): GuestAccessState;
  /** The Trunk tried to drive the pane before the owner allowed it, so the question shows. */
  ask(key: string): void;
  allow(key: string): void;
  dismiss(key: string): void;
  takeOver(key: string): void;
  handBack(key: string): void;
  subscribe(listener: () => void): () => void;
};

type Entry = { allowed: boolean; owner: boolean; asking: boolean };

const IDLE: GuestAccessState = { access: "needs-consent", asking: false };

function accessOf({ allowed, owner, asking }: Entry): GuestAccessState {
  const access: GuestAccess = !allowed ? "needs-consent" : owner ? "owner-control" : "allowed";
  return { access, asking };
}

export function createGuestAccess(): GuestAccessStore {
  const entries = new Map<string, Entry>();
  // One state object per conversation, replaced on change: useSyncExternalStore needs the same object between reads.
  const states = new Map<string, GuestAccessState>();
  const listeners = new Set<() => void>();
  const change = (key: string, patch: Partial<Entry>) => {
    const current = entries.get(key) ?? { allowed: false, owner: false, asking: false };
    const next = { ...current, ...patch };
    entries.set(key, next);
    states.set(key, accessOf(next));
    listeners.forEach((listener) => listener());
  };
  return {
    state: (key) => states.get(key) ?? IDLE,
    ask: (key) => {
      if (!entries.get(key)?.allowed) change(key, { asking: true });
    },
    allow: (key) => change(key, { allowed: true, asking: false }),
    dismiss: (key) => change(key, { asking: false }),
    takeOver: (key) => change(key, { owner: true }),
    handBack: (key) => change(key, { owner: false }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The store the window shares: the pane and the Trunk's requests read the same answers. */
export const guestAccess = createGuestAccess();
