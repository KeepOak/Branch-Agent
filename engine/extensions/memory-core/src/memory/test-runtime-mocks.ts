// Memory indexing tests exercise explicit sync, not physical filesystem events.
import { afterAll, beforeAll, vi } from "vitest";
import {
  configureMemoryCoreRingsStateForTests,
  resetMemoryCoreRingsStateForTests,
} from "../test-helpers.js";

// Reuse the same controlled observation contract as watcher-domain tests. Root
// admission remains real; this fixture simply publishes no unsolicited dirties.
vi.mock("branch/plugin-sdk/file-access-runtime", async (original) => {
  const { createMemoryObservationHarness } = await import("./watcher-test-support.js");
  return {
    ...(await original<typeof import("branch/plugin-sdk/file-access-runtime")>()),
    watch: createMemoryObservationHarness().watch,
  };
});

beforeAll(async () => {
  await configureMemoryCoreRingsStateForTests();
});
afterAll(() => {
  resetMemoryCoreRingsStateForTests();
});
