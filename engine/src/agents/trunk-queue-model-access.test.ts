import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { addQueueItem, listQueueItems, pickUpQueuedWork } from "./trunk-queue.js";
const { eligible } = vi.hoisted(() => ({ eligible: vi.fn(() => false) }));
vi.mock("../infra/account-model-check.js", () => ({ agentHasUsableModel: eligible }));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("leaves jobs unclaimed without a usable model, then dispatches after a paid login passes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-model-queue-"));
  dirs.push(dir);
  const env = { ...process.env, BRANCH_STATE_DIR: dir };
  addQueueItem({ title: "Build", brief_text: "Build the feature" }, env);
  const request = vi.fn(async () => ({ sessions: [] }));
  const gateway = { request } as Parameters<typeof pickUpQueuedWork>[0]["gateway"];
  const params = { gateway, env, agentId: "builder-one" };
  expect(await pickUpQueuedWork(params)).toBeUndefined();
  expect(listQueueItems(env)[0]?.claimed_by).toBeUndefined();
  expect(request.mock.calls.flat()).not.toContain("sessions.create");
  eligible.mockReturnValue(true);
  expect(await pickUpQueuedWork(params)).toBeDefined();
  expect(listQueueItems(env)[0]?.claimed_by).toBe("builder-one");
});
