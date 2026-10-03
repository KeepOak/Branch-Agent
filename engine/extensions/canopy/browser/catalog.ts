import type { GatewayBrowserClient } from "./api/gateway.ts";
import type { CanopyCapability } from "./lib/canopy/capability.ts";
import { loadCanopyCatalog } from "./lib/canopy/loading.ts";
import { getCanopyState, invalidateCanopyLoads } from "./lib/canopy/runtime.ts";
import { CANOPY_CHANGED_EVENT, type CanopyBoardSummary } from "./lib/canopy/types.ts";

type CanopyCatalogSnapshot = {
  boards: readonly Pick<CanopyBoardSummary, "id" | "name" | "icon" | "color">[];
  ready: boolean;
};
type CanopyCatalogRuntime = {
  sync(client: GatewayBrowserClient | null, connected: boolean): void;
  handleGatewayEvent(event: string): void;
  dispose(): void;
};

const RETRY_MS = 2_000;

type CatalogLoad = { client: GatewayBrowserClient; promise: Promise<boolean> };

class CanopyCatalog implements CanopyCatalogRuntime {
  private client: GatewayBrowserClient | null = null;
  private connected = false;
  private disposed = false;
  private generation = 0;
  private connectionGeneration = 0;
  private load: CatalogLoad | null = null;
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
    }
    this.connected = connected;
    if (!connected || !client) {
      if (this.load) {
        // Preserve the cached catalog, but prevent an old request from publishing
        // after disconnect or blocking a fresh load on a fast reconnect.
        this.generation += 1;
        this.load = null;
        invalidateCanopyLoads(this.host);
      }
      this.clearRetry();
      return;
    }
    if (this.client !== client) {
      this.client = client;
      this.generation += 1;
      this.load = null;
      invalidateCanopyLoads(this.host);
      this.host.clearCatalog();
      this.publishCatalog([], false);
    }
    this.ensureAndRecover(reconnecting);
  }

  handleGatewayEvent(event: string): void {
    if (event === CANOPY_CHANGED_EVENT && this.connected && this.client) {
      this.ensureAndRecover(true);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.connectionGeneration += 1;
    this.generation += 1;
    this.load = null;
    this.clearRetry();
    invalidateCanopyLoads(this.host);
    this.host.clearCatalog();
  }

  private ensureAndRecover(force: boolean): void {
    const client = this.client;
    if (!client || !this.connected) {
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
    if (this.disposed || !this.connected || this.client !== client) {
      return false;
    }
    if (!force && this.snapshot.ready) {
      return false;
    }
    const currentLoad = this.load;
    if (currentLoad?.client === client) {
      const loaded = await currentLoad.promise;
      if (this.disposed || !this.connected || this.client !== client) {
        return false;
      }
      if (!force) {
        return loaded;
      }
      if (this.load && this.load !== currentLoad) {
        return await this.load.promise;
      }
      if (this.load === currentLoad) {
        this.load = null;
      }
      return await this.ensure(client, true);
    }
    const generation = ++this.generation;
    const pending = (async () => {
      try {
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
      } catch {
        return false;
      }
    })();
    const load = { client, promise: pending };
    this.load = load;
    try {
      return await pending;
    } finally {
      if (this.load === load) {
        this.load = null;
      }
    }
  }

  private publishCatalog(boards: CanopyBoardSummary[], ready: boolean): void {
    this.host.setBoardsReady(ready);
    this.host.notify();
    const snapshot: CanopyCatalogSnapshot = {
      boards: boards.map(({ id, name, icon, color }) => ({
        id,
        ...(name ? { name } : {}),
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

export function createCanopyCatalogRuntime(
  onSnapshot: (snapshot: CanopyCatalogSnapshot) => void,
  host: CanopyCapability,
): CanopyCatalogRuntime {
  return new CanopyCatalog(onSnapshot, host);
}
