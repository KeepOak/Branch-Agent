import { expect, test } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { projectCanonicalSessionEntryShape } from "../config/sessions/store-entry-shape.js";
import { listSessionFixture } from "./session-list.test-support.js";
import { createModelDefaultsConfig } from "./session-utils.test-support.js";
import { MAIN_SESSION_KEY, runPatch, expectPatchOk } from "./sessions-patch.test-support.js";

const key = "agent:main:dashboard:work";

test("sessions.patch sets done on the session row and clears it", async () => {
  const store: Record<string, SessionEntry> = {
    [key]: { sessionId: "work", updatedAt: 1, parentSessionKey: MAIN_SESSION_KEY },
  };
  const cfg = createModelDefaultsConfig({ primary: "openai/gpt-5.4" });
  const patch = (done: boolean | null) =>
    runPatch({ store, storeKey: key, cfg, patch: { key, done, expectedSessionId: "work" } });
  expect(expectPatchOk(await patch(true)).done).toBe(true);
  expect(projectCanonicalSessionEntryShape(JSON.parse(JSON.stringify(store[key]))).done).toBe(true);
  const list = () => listSessionFixture({ cfg, storePath: "", store, opts: {} });
  expect((await list()).sessions.find((row) => row.key === key)?.done).toBe(true);
  expect(expectPatchOk(await patch(false)).done).toBeUndefined();
  expect((await list()).sessions.find((row) => row.key === key)?.done).toBeUndefined();
  expect(expectPatchOk(await patch(true)).done).toBe(true);
  expect(expectPatchOk(await patch(null)).done).toBeUndefined();
});
