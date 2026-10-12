import type { GatewayBrowserClient } from "./api/gateway.ts";
import type { CanopyCapability } from "./lib/canopy/capability.ts";
import { loadCanopyCatalog } from "./lib/canopy/loading.ts";
import {
  getCanopyRuntime,
  getCanopyState,
  hasCurrentCanopyCards,
  invalidateCanopyLoads,
} from "./lib/canopy/runtime.ts";
import { CANOPY_CHANGED_EVENT, type CanopyBoardSummary } from "./lib/canopy/types.ts";

type CanopyCatalogSnapshot = {
  boards: readonly Pick<CanopyBoardSummary, "id" | "name" | "kind" | "icon" | "color">[];
  ready: boolean;
};

const RETRY_MS = 2_000;

export class CanopyCatalog {
  private client: GatewayBrowserClient | null = null;
  private connected = false;
  private disposed = false;
  private generation = 0;
  private connectionGeneration = 0;
  private retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private snapshot: CanopyCatalogSnapshot = { boards: [], ready: false };

  constructor(
    private readonly onSnapshot: (snapshot: CanopyCatalogSnapshot) => void,
    private readonly host: CanopyCapability,
  ) {}

  sync(client: GatewayBrowserClient | null, connected: boolean): void {
    if (this.disposed) {
      return;
    }
    const reconnecting = connected && !this.connected && this.snapshot.ready;
    if (this.connected !== connected || this.client !== client) {
      this.connectionGeneration += 1;
      this.generation += 1;
      invalidateCanopyLoads(this.host);
    }
    this.connected = connected;
    if (!connected || !client) {
      this.clearRetry();
      return;
    }
    if (this.client !== client) {
      this.client = client;
      this.host.clearCatalog();
      this.publishCatalog([], false);
    }
    this.ensureAndRecover(reconnecting);
  }

  handleGatewayEvent(event: string, payload?: unknown): void {
    if (
      event === CANOPY_CHANGED_EVENT &&
      this.connected &&
      this.client &&
      !hasCurrentCanopyCards(this.host, payload)
    ) {
      this.ensureAndRecover(true);
    }
  }

  removeBoard(id: string): void {
    this.generation += 1;
    invalidateCanopyLoads(this.host);
    const state = getCanopyState(this.host);
    state.boards = state.boards.filter((board) => board.id !== id);
    this.publishCatalog(state.boards, this.snapshot.ready);
    this.ensureAndRecover(true);
  }

  dispose(): void {
    this.disposed = true;
    this.connectionGeneration += 1;
    this.generation += 1;
    this.clearRetry();
    invalidateCanopyLoads(this.host);
    this.host.clearCatalog();
  }

  private ensureAndRecover(force: boolean): void {
    const client = this.client;
    if (this.disposed || !client || !this.connected) {
      return;
    }
    const connectionGeneration = this.connectionGeneration;
    void this.ensure(client, force).then((loaded) => {
      if (
        this.disposed ||
        !this.connected ||
        this.client !== client ||
        connectionGeneration !== this.connectionGeneration
      ) {
        return;
      }
      if (loaded) {
        this.clearRetry();
        return;
      }
      if (!force && this.snapshot.ready) {
        return;
      }
      if (this.retryTimer === null) {
        this.retryTimer = globalThis.setTimeout(() => {
          this.retryTimer = null;
          this.ensureAndRecover(true);
        }, RETRY_MS);
      }
    });
  }

  private async ensure(client: GatewayBrowserClient, force: boolean): Promise<boolean> {
    if (!force && (this.snapshot.ready || getCanopyRuntime(this.host).loadPromise)) {
      return false;
    }
    const generation = ++this.generation;
    const loaded = await loadCanopyCatalog({
      host: this.host,
      client,
      requestUpdate: this.host.notify,
    });
    if (
      !loaded ||
      this.disposed ||
      !this.connected ||
      this.client !== client ||
      generation !== this.generation
    ) {
      return false;
    }
    this.publishCatalog(getCanopyState(this.host).boards, true);
    return true;
  }

  private publishCatalog(boards: CanopyBoardSummary[], ready: boolean): void {
    this.host.setBoardsReady(ready);
    this.host.notify();
    const snapshot: CanopyCatalogSnapshot = {
      boards: boards.map(({ id, name, kind, icon, color }) => ({
        id,
        ...(name ? { name } : {}),
        ...(kind ? { kind } : {}),
        ...(icon ? { icon } : {}),
        ...(color ? { color } : {}),
      })),
      ready,
    };
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      globalThis.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
