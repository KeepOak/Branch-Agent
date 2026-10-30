import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GraftLinkRunner, type LinkHandlers } from "./graft-link.js";

let dir: string;
let old: string | undefined;
const runners: GraftLinkRunner[] = [];
beforeEach(() => {
  old = process.env.BRANCH_STATE_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "graft-retry-"));
  process.env.BRANCH_STATE_DIR = dir;
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});
afterEach(() => {
  for (const runner of runners.splice(0)) {
    runner.stop();
  }
  vi.useRealTimers();
  if (old === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = old;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
const flush = async () => {
  await new Promise(setImmediate);
  await new Promise(setImmediate);
};
it("replays the saved completion after runner restart without executing the Trunk again", async () => {
  let fail = true;
  const complete = vi.fn(async () => {
    if (fail) {
      throw new Error("transport lost");
    }
    return {};
  });
  const work = vi.fn(async () => ({ reply: "saved answer" }));
  function start() {
    let handlers!: LinkHandlers;
    const runner = new GraftLinkRunner({
      link: { url: "ws://127.0.0.1:41011", name: "Host", joinedAt: 1 },
      trunks: async () => [],
      forget: vi.fn(),
      log: vi.fn(),
      handleWork: work,
      createClient: (h) => {
        handlers = h;
        return {
          start() {},
          stop() {},
          request: async (method) =>
            method === "graft.work.poll"
              ? { job: { id: "job", trunkId: "worker", text: "work", sourceAgentId: "owner" } }
              : method === "graft.work.complete"
                ? complete()
                : {},
        };
      },
    });
    runners.push(runner);
    runner.start();
    handlers.onHello();
    return runner;
  }
  const first = start();
  await flush();
  first.stop();
  expect(complete).toHaveBeenCalledTimes(1);
  fail = false;
  start();
  await flush();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(work).toHaveBeenCalledTimes(1);
});
