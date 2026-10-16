// The Computers list: the engine's environments, read with environments.list and refreshed on
// every environments.changed (and node presence) event, the way the window's listComputers
// (window/src/stage/computers.ts) does. The phone shows names and online/offline status only.
import type { EngineLink } from '../pairing/pairingSession';

export type ComputerStatus = 'online' | 'offline' | 'starting' | 'stopping' | 'error';

export type ComputerRow = {
  id: string;
  /** What the row is called: "This computer" for the host, else the engine's label or id. */
  name: string;
  status: ComputerStatus;
  /** Online, Offline, Starting, Stopping, or Has a problem. */
  statusLabel: string;
  /** Windows, macOS, Linux, or the engine's platform string. */
  os: string;
  /** When the engine last saw an offline computer (ms). */
  lastSeenAtMs: number | null;
};

const OS: Record<string, string> = { win32: 'Windows', windows: 'Windows', darwin: 'macOS', macos: 'macOS', linux: 'Linux' };
const STATUS_OF: Record<string, ComputerStatus> = {
  available: 'online',
  unavailable: 'offline',
  starting: 'starting',
  stopping: 'stopping',
  error: 'error',
};
const STATUS_LABEL: Record<ComputerStatus, string> = {
  online: 'Online',
  offline: 'Offline',
  starting: 'Starting',
  stopping: 'Stopping',
  error: 'Has a problem',
};

/** Events that mean the inventory or a node's reachability changed. */
export const COMPUTER_EVENTS = ['environments.changed', 'node.presence', 'node.runnerInventory.changed'] as const;

export type ComputerListSnapshot = {
  rows: ComputerRow[];
  /** A read has landed, on this connection or an earlier one. */
  loaded: boolean;
  error: string | null;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The name a person sees for a computer: the host is "This computer"; otherwise the engine's label, then its id. */
export function computerName(raw: unknown): string {
  const r = rec(raw);
  const id = str(r.id);
  return id === 'gateway' ? 'This computer' : str(r.label) || id || 'A computer';
}

/** One environments.list row as a Computers row. */
export function readComputer(raw: unknown): ComputerRow | null {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const status = STATUS_OF[str(r.status)] ?? 'offline';
  const platform = str(r.platform);
  return {
    id,
    name: computerName(r),
    status,
    statusLabel: STATUS_LABEL[status],
    os: (platform && OS[platform.toLowerCase()]) || platform,
    lastSeenAtMs: num(r.lastSeenAtMs) || null,
  };
}

/** Every computer the engine listed, the host first, then the rest in the engine's order. */
export function computerRows(list: unknown): ComputerRow[] {
  const environments = rec(list).environments;
  const raw = Array.isArray(environments) ? environments : [];
  return raw
    .map(readComputer)
    .filter((row): row is ComputerRow => row !== null)
    .sort((a, b) => (a.id === 'gateway' ? -1 : b.id === 'gateway' ? 1 : 0));
}

export class ComputerList {
  private snapshot: ComputerListSnapshot = { rows: [], loaded: false, error: null };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private readonly offs: Array<() => void> = [];
  private disposed = false;

  constructor(private readonly link: EngineLink) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ComputerListSnapshot => this.snapshot;

  /** Reads now if the computer is connected, and again on every reconnect and every change. */
  attach(): void {
    this.disposed = false;
    this.offs.push(
      this.link.onConnected(() => void this.start()),
      this.link.onEvent((event) => this.onEvent(event)),
    );
    if (this.link.hello) void this.start();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Forgets every row, after the phone unpairs. */
  reset(): void {
    this.set({ rows: [], loaded: false, error: null });
  }

  /** Reads the first page of computers. */
  async start(): Promise<void> {
    try {
      this.apply(await this.link.request('environments.list', {}));
    } catch (error) {
      this.set({ error: messageOf(error) });
    }
  }

  onEvent(event: string): void {
    if (COMPUTER_EVENTS.some((name) => event === name || event.startsWith(`${name}.`))) {
      this.refreshSoon();
    }
  }

  refreshSoon(delayMs = 150): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  /** Reads the list again; overlapping calls collapse into one trailing read. */
  refresh(): Promise<void> {
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const read = async () => {
      await Promise.resolve();
      try {
        do {
          this.again = false;
          try {
            this.apply(await this.link.request('environments.list', {}));
          } catch (error) {
            this.set({ error: messageOf(error) });
          }
        } while (this.again && !this.disposed);
      } finally {
        this.inFlight = null;
      }
    };
    this.inFlight = read();
    return this.inFlight;
  }

  private apply(list: unknown): void {
    this.set({ rows: computerRows(list), loaded: true, error: null });
  }

  private set(patch: Partial<ComputerListSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
