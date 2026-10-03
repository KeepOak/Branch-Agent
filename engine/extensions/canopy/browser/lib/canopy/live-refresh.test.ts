import "../../test/host.setup.ts";
import { createDeferred } from "branch/plugin-sdk/extension-shared";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForFast } from "../../test/wait-for.ts";
import { normalizeCanopyChange } from "./change-payload.ts";
import {
  configureCanopyLiveRefresh,
  handleCanopyChanged,
  resumeCanopyLiveRefresh,
} from "./live-refresh.ts";
import { loadCanopy } from "./loading.ts";
import { stopCanopyLiveRefresh, getCanopyState } from "./runtime.ts";

function createClient(run: (method: string) => unknown) {
  return { request: vi.fn(async (method: string) => run(method)) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Canopy live refresh", () => {
  it("validates the bounded invalidation payload", () => {
    expect(normalizeCanopyChange({ epoch: "epoch-a", revision: 1 })).toEqual({
      epoch: "epoch-a",
      revision: 1,
    });
    expect(normalizeCanopyChange({ epoch: "", revision: 1 })).toBeNull();
    expect(normalizeCanopyChange({ epoch: "epoch-a", revision: 0 })).toBeNull();
    expect(normalizeCanopyChange({ epoch: "epoch-a", revision: Number.NaN })).toBeNull();
    expect(normalizeCanopyChange({ epoch: "epoch-a", revision: 1, cards: [] })).toBeNull();
  });

  it("rereads canonical cards and ignores stale revisions", async () => {
    const host = {};
    const client = createClient((method) =>
      method === "canopy.cards.list"
        ? {
            cards: [
              {
                id: "card-1",
                title: "Updated elsewhere",
                status: "todo",
                priority: "normal",
                labels: [],
                position: 1,
                createdAt: 1,
                updatedAt: 2,
              },
            ],
            statuses: ["todo", "done"],
          }
        : { tasks: [] },
    );
    configureCanopyLiveRefresh({ host, client: client as never });

    expect(handleCanopyChanged(host, { epoch: "epoch-a", revision: 2 })).toBe(true);
    await waitForFast(() =>
      expect(getCanopyState(host).cards[0]?.title).toBe("Updated elsewhere"),
    );
    expect(handleCanopyChanged(host, { epoch: "epoch-a", revision: 1 })).toBe(false);
    expect(
      client.request.mock.calls.filter(([method]) => method === "canopy.cards.list"),
    ).toHaveLength(1);
    expect(client.request).not.toHaveBeenCalledWith(
      "canopy.cards.diagnostics.refresh",
      expect.anything(),
    );
  });

  it("requests one canonical reload for each newly installed client", () => {
    const host = {};
    const first = createClient(() => ({ cards: [], statuses: ["todo", "done"] }));
    const second = createClient(() => ({ cards: [], statuses: ["todo", "done"] }));

    expect(configureCanopyLiveRefresh({ host, client: first as never })).toBe(true);
    expect(configureCanopyLiveRefresh({ host, client: first as never })).toBe(false);
    expect(configureCanopyLiveRefresh({ host, client: second as never })).toBe(true);
  });

  it("coalesces revisions that arrive during a canonical read", async () => {
    const host = {};
    const firstList = createDeferred<unknown>();
    let listCalls = 0;
    const client = createClient((method) => {
      if (method === "canopy.cards.list") {
        listCalls += 1;
        return listCalls === 1 ? firstList.promise : { cards: [], statuses: ["todo", "done"] };
      }
      return { tasks: [] };
    });
    configureCanopyLiveRefresh({ host, client: client as never });

    handleCanopyChanged(host, { epoch: "epoch-a", revision: 1 });
    await waitForFast(() => expect(listCalls).toBe(1));
    handleCanopyChanged(host, { epoch: "epoch-a", revision: 2 });
    handleCanopyChanged(host, { epoch: "epoch-a", revision: 3 });
    firstList.resolve({ cards: [], statuses: ["todo", "done"] });

    await waitForFast(() => expect(listCalls).toBe(2));
    await Promise.resolve();
    expect(listCalls).toBe(2);
  });

  it("defers during edits and resumes after the local draft closes", async () => {
    const host = {};
    const requestUpdate = vi.fn();
    const client = createClient((method) =>
      method === "canopy.cards.list" ? { cards: [], statuses: ["todo", "done"] } : { tasks: [] },
    );
    const state = getCanopyState(host);
    state.draftOpen = true;
    state.editingCardId = "card-1";
    configureCanopyLiveRefresh({ host, client: client as never, requestUpdate });

    handleCanopyChanged(host, { epoch: "epoch-a", revision: 1 });
    await Promise.resolve();
    expect(client.request).not.toHaveBeenCalled();
    expect(requestUpdate).not.toHaveBeenCalled();

    state.draftOpen = false;
    state.editingCardId = null;
    resumeCanopyLiveRefresh(host);
    await waitForFast(() =>
      expect(client.request).toHaveBeenCalledWith("canopy.cards.list", {}),
    );
  });

  it("retries transient failures and treats a new epoch as authoritative", async () => {
    vi.useFakeTimers();
    const host = {};
    let fail = true;
    const client = createClient((method) => {
      if (method !== "canopy.cards.list") {
        return { tasks: [] };
      }
      if (fail) {
        throw new Error("temporarily unavailable");
      }
      return { cards: [], statuses: ["todo", "done"] };
    });
    configureCanopyLiveRefresh({ host, client: client as never });

    handleCanopyChanged(host, { epoch: "epoch-a", revision: 9 });
    await waitForFast(() =>
      expect(client.request).toHaveBeenCalledWith("canopy.cards.list", {}),
    );
    resumeCanopyLiveRefresh(host);
    configureCanopyLiveRefresh({ host, client: client as never });
    await Promise.resolve();
    expect(
      client.request.mock.calls.filter(([method]) => method === "canopy.cards.list"),
    ).toHaveLength(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(
      client.request.mock.calls.filter(([method]) => method === "canopy.cards.list"),
    ).toHaveLength(2);

    expect(handleCanopyChanged(host, { epoch: "epoch-b", revision: 1 })).toBe(true);
    await waitForFast(() =>
      expect(
        client.request.mock.calls.filter(([method]) => method === "canopy.cards.list"),
      ).toHaveLength(3),
    );
    stopCanopyLiveRefresh(host);
  });

  it("discards a live read that completes after teardown", async () => {
    const host = {};
    const list = createDeferred<unknown>();
    const client = createClient((method) =>
      method === "canopy.cards.list" ? list.promise : { tasks: [] },
    );
    configureCanopyLiveRefresh({ host, client: client as never });
    handleCanopyChanged(host, { epoch: "epoch-a", revision: 1 });
    await waitForFast(() =>
      expect(client.request).toHaveBeenCalledWith("canopy.cards.list", {}),
    );

    stopCanopyLiveRefresh(host);
    list.resolve({
      cards: [
        {
          id: "stale-card",
          title: "Must not apply",
          status: "todo",
          priority: "normal",
          labels: [],
          position: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      statuses: ["todo", "done"],
    });
    await list.promise;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(getCanopyState(host).cards).toEqual([]);
  });

  it("discards a direct canonical read that completes after teardown", async () => {
    const host = {};
    const list = createDeferred<unknown>();
    const client = createClient((method) =>
      method === "canopy.cards.list" ? list.promise : { tasks: [] },
    );
    configureCanopyLiveRefresh({ host, client: client as never });
    const loading = loadCanopy({ host, client: client as never, force: true });
    await waitForFast(() =>
      expect(client.request).toHaveBeenCalledWith("canopy.cards.list", {}),
    );

    stopCanopyLiveRefresh(host);
    list.resolve({
      cards: [
        {
          id: "stale-card",
          title: "Must not apply",
          status: "todo",
          priority: "normal",
          labels: [],
          position: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      statuses: ["todo", "done"],
    });

    await expect(loading).resolves.toBe(false);
    expect(getCanopyState(host).cards).toEqual([]);
    expect(getCanopyState(host).loading).toBe(false);
  });
});
