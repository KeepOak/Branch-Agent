import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  completeGraftWork,
  deliverPendingGraftWork,
  enqueueGraftWork,
  getGraftWork,
} from "./graft-work.js";

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "graft-durable-"));
  env = { ...process.env, BRANCH_STATE_DIR: dir };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const input = {
  deviceId: "device",
  trunkId: "worker",
  text: "work",
  sourceSessionKey: "agent:owner:main",
  sourceAgentId: "owner",
};
it("fails closed on corrupt work rather than overwriting queued results", () => {
  const target = path.join(dir, "graft", "work.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "{broken");
  expect(() => enqueueGraftWork(input, env)).toThrow();
  expect(fs.readFileSync(target, "utf8")).toBe("{broken");
});
it("fails closed on invalid rows and a non-array work store", () => {
  const target = path.join(dir, "graft", "work.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  for (const value of ["{}", '[{"id":"lost"}]']) {
    fs.writeFileSync(target, value);
    expect(() => enqueueGraftWork(input, env)).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe(value);
  }
});
it("persists pending result delivery, preserving the first result on duplicate completion", () => {
  const job = enqueueGraftWork(input, env);
  completeGraftWork(job.id, "device", { reply: "answer" }, env);
  expect(getGraftWork(job.id, env)).toMatchObject({ reply: "answer", deliveryState: "pending" });
  completeGraftWork(job.id, "device", { reply: "different" }, env);
  expect(getGraftWork(job.id, env)).toMatchObject({ reply: "answer", deliveryState: "pending" });
});
it("retries a failed durable delivery and suppresses concurrent duplicate delivery", async () => {
  const job = enqueueGraftWork(input, env);
  completeGraftWork(job.id, "device", { reply: "answer" }, env);
  await expect(
    deliverPendingGraftWork(
      "device",
      async () => {
        throw new Error("offline");
      },
      env,
    ),
  ).rejects.toThrow("offline");
  expect(getGraftWork(job.id, env)?.deliveryState).toBe("pending");
  let release!: () => void;
  let calls = 0;
  const attempt = deliverPendingGraftWork(
    "device",
    async () => {
      calls++;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    env,
  );
  await deliverPendingGraftWork(
    "device",
    async () => {
      calls++;
    },
    env,
  );
  expect(calls).toBe(1);
  release();
  await attempt;
  expect(getGraftWork(job.id, env)?.deliveryState).toBe("delivered");
  await deliverPendingGraftWork(
    "device",
    async () => {
      calls++;
    },
    env,
  );
  expect(calls).toBe(1);
});
