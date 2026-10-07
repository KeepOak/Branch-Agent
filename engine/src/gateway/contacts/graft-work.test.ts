import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { claimGraftWork, completeGraftWork, enqueueGraftWork, getGraftWork } from "./graft-work.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

it("keeps reverse graft work on disk for the paired device, deduplicates a retry, and records one reply", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-graft-work-"));
  dirs.push(dir);
  const env = { ...process.env, BRANCH_STATE_DIR: dir };
  const input = { deviceId: "nas-device", trunkId: "tester", text: "Ping", sourceSessionKey: "agent:juniper:main", sourceAgentId: "juniper", idempotencyKey: "send-1" };
  const job = enqueueGraftWork(input, env);
  const claimedAt = Date.now();
  expect(enqueueGraftWork(input, env).id).toBe(job.id);
  expect(claimGraftWork("other-device", env)).toBeUndefined();
  expect(claimGraftWork("nas-device", env, claimedAt)?.id).toBe(job.id);
  expect(claimGraftWork("nas-device", env, claimedAt + 1_000)).toBeUndefined();
  expect(claimGraftWork("nas-device", env, claimedAt + 15 * 60_000)?.id).toBe(job.id);
  expect(completeGraftWork(job.id, "other-device", { reply: "forged" }, env)).toBeUndefined();
  expect(completeGraftWork(job.id, "nas-device", { reply: "PONG" }, env)?.reply).toBe("PONG");
  expect(completeGraftWork(job.id, "nas-device", { reply: "duplicate" }, env)?.reply).toBe("PONG");
  expect(getGraftWork(job.id, env)?.completedAt).toBeTypeOf("number");
  expect(claimGraftWork("nas-device", env)).toBeUndefined();
});
