import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveStateDir } from "../config/paths.js";
import { addQueueItem, listQueueItems } from "./trunk-queue.js";

const execFileAsync = promisify(execFile);
const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TSX_LOADER = pathToFileURL(path.join(ENGINE_ROOT, "scripts", "tsx.mjs")).href;
const QUEUE_MODULE = pathToFileURL(path.join(ENGINE_ROOT, "src", "agents", "trunk-queue.ts")).href;

let dir = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-trunk-lock-"));
  env = { BRANCH_STATE_DIR: dir };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A separate Node process that adds `count` jobs to the same queue file, through its own module instance. */
function writerScript(): string {
  const script = path.join(dir, "writer.mts");
  fs.writeFileSync(
    script,
    `import { addQueueItem } from ${JSON.stringify(QUEUE_MODULE)};
const [tag, count] = [process.argv[2], Number(process.argv[3])];
for (let i = 0; i < count; i += 1) {
  addQueueItem({ title: \`\${tag}-\${i}\`, brief_text: "brief" }, process.env);
}
`,
  );
  return script;
}

describe("Trunk queue file lock", () => {
  it("keeps every update when two processes write the queue at the same time", async () => {
    const count = 60;
    const script = writerScript();
    await Promise.all(
      ["alpha", "beta"].map((tag) =>
        execFileAsync(process.execPath, ["--import", TSX_LOADER, script, tag, String(count)], {
          env: { ...process.env, BRANCH_STATE_DIR: dir },
        }),
      ),
    );

    const titles = listQueueItems(env).map((row) => row.title);
    expect(titles).toHaveLength(2 * count);
    expect(new Set(titles).size).toBe(2 * count);
  }, 120_000);

  it("reclaims a queue lock left behind by a process that has exited", () => {
    // A child that has exited: its PID is definitely dead now.
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    const queueLock = `${path.join(resolveStateDir(env), "trunks", "queue.json")}.lock`;
    fs.mkdirSync(path.dirname(queueLock), { recursive: true });
    fs.writeFileSync(queueLock, JSON.stringify({ pid: dead, createdAt: new Date().toISOString() }));

    expect(() =>
      addQueueItem({ title: "after the crash", brief_text: "brief" }, env),
    ).not.toThrow();
    expect(listQueueItems(env).map((row) => row.title)).toEqual(["after the crash"]);
  });
});
