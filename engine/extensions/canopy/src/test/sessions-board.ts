import { afterEach, vi } from "vitest";
import { createCanopySessionsBoardService } from "../sessions-board.js";
import type { CanopyStore } from "../store.js";

const services: Array<ReturnType<typeof createCanopySessionsBoardService>> = [];

afterEach(async () => {
  try {
    for (const service of services.splice(0)) {
      await service.stop();
    }
  } finally {
    vi.useRealTimers();
  }
});

/** Adapter tests use real board persistence with an empty session roster. */
export async function startEmptySessionsBoardService(store: CanopyStore) {
  const service = createCanopySessionsBoardService({
    store,
    gateway: {
      request: vi.fn().mockResolvedValue({ sessions: [] }),
      readSessionFacts: vi.fn().mockResolvedValue({ sessions: [] }),
      subscribeSessionChanges: () => () => {},
    },
  });
  services.push(service);
  await service.start({
    config: {},
    stateDir: "unused",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return service;
}
