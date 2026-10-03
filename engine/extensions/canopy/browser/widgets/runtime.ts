import type { ControlUiHost } from "branch/plugin-sdk/control-ui";
import type { GatewayBrowserClient } from "../api/gateway.ts";
import { formatUiError } from "../lib/format-error.ts";
import { isActiveCanopyCard, nextCanopyCardPosition } from "../lib/canopy/card-state.ts";
import { moveCanopyCard } from "../lib/canopy/mutations.ts";
import { normalizeCardsPayload } from "../lib/canopy/normalization.ts";
import {
  getCanopyRuntime,
  getCanopyState,
  isCurrentCanopyLoadGeneration,
  nextCanopyLoadGeneration,
  canopyHasActiveWrites,
} from "../lib/canopy/runtime.ts";
import {
  CANOPY_CHANGED_EVENT,
  type CanopyCard,
  type CanopyStatus,
} from "../lib/canopy/types.ts";

export type CanopyWidgetRuntime = {
  owner: object;
  client: GatewayBrowserClient;
  connected: boolean;
  loading: boolean;
  listeners: Set<() => void>;
  refresh: () => Promise<void>;
  notify: () => void;
  dispose: () => void;
};

const runtimes = new WeakMap<ControlUiHost, CanopyWidgetRuntime>();

export function acquireWidgetRuntime(host: ControlUiHost, listener: () => void) {
  let runtime = runtimes.get(host);
  if (!runtime) {
    let disposed = false;
    let pending: { error: string | null } | null = null;
    let load: Promise<void> | null = null;
    async function runPendingRefresh(): Promise<void> {
      if (!pending || disposed || !current.connected) {
        return;
      }
      if (load) {
        return load;
      }
      const owner = current.owner;
      const state = getCanopyState(owner);
      const canopyRuntime = getCanopyRuntime(owner);
      if (canopyHasActiveWrites(state)) {
        return;
      }
      const isCurrent = () => !disposed && current.owner === owner;
      const run = (async () => {
        while (pending && isCurrent() && current.connected && !canopyHasActiveWrites(state)) {
          const request = pending;
          pending = null;
          current.loading = true;
          // Mutations invalidate this owner generation before writing, fencing older snapshots.
          const loadGeneration = nextCanopyLoadGeneration(owner);
          const isCurrentLoad = () =>
            isCurrent() && isCurrentCanopyLoadGeneration(owner, loadGeneration);
          // A deferred request must preserve newer write failures; read failures can recover.
          if (state.error === request.error || state.error === canopyRuntime.loadError) {
            state.error = null;
          }
          delete canopyRuntime.loadError;
          current.notify();
          try {
            const snapshot = normalizeCardsPayload(
              await current.client.request("canopy.cards.list", {}),
            );
            if (!isCurrentLoad()) {
              continue;
            }
            state.cards = snapshot.cards;
            state.statuses = snapshot.statuses;
            state.loaded = true;
            state.loadAttempted = true;
            state.mutationReadiness = "ready";
          } catch (error) {
            if (isCurrentLoad() && state.error === null) {
              canopyRuntime.loadError = formatUiError(error);
              state.error = canopyRuntime.loadError;
            }
          } finally {
            if (isCurrent()) {
              current.loading = false;
              current.notify();
            }
          }
        }
      })();
      load = run;
      try {
        await run;
      } finally {
        if (load === run) {
          load = null;
          // A write can settle after the loop defers but before this promise detaches.
          // Its notification still saw the old load; resume the retained request here too.
          if (pending) {
            void runPendingRefresh();
          }
        }
      }
    }
    const current: CanopyWidgetRuntime = {
      owner: {},
      client: host,
      connected: host.connection.connected,
      loading: false,
      listeners: new Set(),
      notify() {
        for (const notify of current.listeners) {
          notify();
        }
        if (pending && !load) {
          void runPendingRefresh();
        }
      },
      async refresh() {
        if (disposed || !current.connected) {
          return;
        }
        pending = { error: getCanopyState(current.owner).error };
        return runPendingRefresh();
      },
      dispose() {
        disposed = true;
        stopHost();
        stopEvents();
        current.listeners.clear();
      },
    };
    const stopHost = host.subscribe(() => {
      if (current.connected !== host.connection.connected) {
        current.connected = host.connection.connected;
        load = null;
        pending = null;
        current.owner = {};
        current.loading = false;
        if (current.connected) {
          void current.refresh();
        }
      }
      current.notify();
    });
    const stopEvents = host.onEvent(CANOPY_CHANGED_EVENT, () => {
      void current.refresh();
    });
    runtime = current;
    runtimes.set(host, runtime);
  }
  const entry = runtime;
  entry.listeners.add(listener);
  if (!getCanopyState(entry.owner).loaded && !entry.loading) {
    void entry.refresh();
  }
  return {
    runtime: entry,
    release() {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0 && runtimes.get(host) === entry) {
        runtimes.delete(host);
        entry.dispose();
      }
    },
  };
}

export class CanopyWidgetModel {
  constructor(
    readonly host: ControlUiHost,
    readonly runtime: CanopyWidgetRuntime,
    public props: Readonly<Record<string, unknown>>,
    private readonly isActive: () => boolean,
    private readonly mutationAllowed: () => boolean,
  ) {}
  get canMutate() {
    return this.isActive() && this.mutationAllowed();
  }
  get connected() {
    return this.runtime.connected;
  }
  get canopyStateHost() {
    return this.runtime.owner;
  }
  get canopyClient() {
    return this.canMutate && this.runtime.connected ? this.host : null;
  }
  get cards() {
    return getCanopyState(this.runtime.owner).cards.filter(isActiveCanopyCard);
  }
  get statuses() {
    return getCanopyState(this.runtime.owner).statuses;
  }
  get loaded() {
    return getCanopyState(this.runtime.owner).loaded;
  }
  get error() {
    return getCanopyState(this.runtime.owner).error;
  }
  readStringProp(key: string) {
    const value = this.props[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
  readPositiveIntegerProp(key: string, fallback: number) {
    const value = this.props[key];
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
  }
  retryLoad() {
    if (this.isActive()) {
      void this.runtime.refresh();
    }
  }
  async moveCard(card: CanopyCard, status: CanopyStatus) {
    const client = this.canopyClient;
    if (!client || !isActiveCanopyCard(card) || card.status === status) {
      return;
    }
    const owner = this.runtime.owner;
    await moveCanopyCard({
      host: owner,
      client,
      cardId: card.id,
      status,
      position: nextCanopyCardPosition(getCanopyState(owner).cards, card, status),
      requestUpdate: () => {
        if (owner === this.runtime.owner) {
          this.runtime.notify();
        }
      },
    });
  }
  async handleStatusChange(event: Event) {
    const card = this.cards.find((candidate) => candidate.id === this.readStringProp("cardId"));
    // SAFETY: The card renderer attaches this handler directly to its native status select.
    const selected = (event.currentTarget as HTMLSelectElement).value;
    const status = this.statuses.find((candidate) => candidate === selected);
    if (card && status) {
      await this.moveCard(card, status);
    }
  }
}
