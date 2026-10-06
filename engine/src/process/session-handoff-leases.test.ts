import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { enqueueCommandInLane } from "./command-queue.js";
import { resetCommandQueueStateForTest } from "./command-queue.test-support.js";
import {
  resolveSessionHandoffLeaseDir,
  sessionHandoffLeaseFile,
  writeSessionHandoffLease,
} from "./session-handoff-lease-files.js";
import {
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
  SessionHandoffLeaseTimeoutError,
} from "./session-handoff-lease-gate.js";
import { holdSessionHandoffLeases } from "./session-handoff-lease-holder.js";

const LEASED = "session:agent:main:leased";
const OTHER = "session:agent:main:other";
let stateDir: string;
let previousStateDir: string | undefined;
const children: ChildProcess[] = [];

beforeEach(() => {
  resetCommandQueueStateForTest();
  resetSessionHandoffLeaseGateForTest();
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-session-lease-"));
  previousStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = stateDir;
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
  resetSessionHandoffLeaseGateForTest();
  if (previousStateDir === undefined) delete process.env.BRANCH_STATE_DIR;
  else process.env.BRANCH_STATE_DIR = previousStateDir;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

/** Another live process standing in for the previous engine. */
async function liveProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
  children.push(child);
  await new Promise((resolve) => child.once("spawn", resolve));
  return child;
}

/** A lease file exactly as the previous engine would write it, held by `pid`. */
function leaseFor(lane: string, pid: number): string {
  const dir = resolveSessionHandoffLeaseDir();
  const { file, lease } = writeSessionHandoffLease(dir, lane);
  fs.writeFileSync(file, JSON.stringify({ ...lease, pid }));
  return file;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("session handoff leases", () => {
  it("runs every other session at once and a leased session only after the previous engine releases it", async () => {
    const holder = await liveProcess();
    const file = leaseFor(LEASED, holder.pid!);
    refreshSessionHandoffLeases();
    const order: string[] = [];
    const leased = enqueueCommandInLane(LEASED, async () => order.push("leased"));
    const second = enqueueCommandInLane(LEASED, async () => order.push("leased again"));
    await enqueueCommandInLane(OTHER, async () => order.push("other"));
    await pause(300);
    expect(order).toEqual(["other"]);
    fs.unlinkSync(file);
    await Promise.all([leased, second]);
    expect(order).toEqual(["other", "leased", "leased again"]);
  });

  it("ignores a lease whose holder has died", async () => {
    const holder = await liveProcess();
    leaseFor(LEASED, holder.pid!);
    holder.kill();
    await new Promise((resolve) => holder.once("exit", resolve));
    refreshSessionHandoffLeases();
    await expect(enqueueCommandInLane(LEASED, async () => "ran")).resolves.toBe("ran");
  });

  it("releases waiting work when the holder dies without releasing", async () => {
    const holder = await liveProcess();
    leaseFor(LEASED, holder.pid!);
    refreshSessionHandoffLeases();
    const leased = enqueueCommandInLane(LEASED, async () => "ran");
    await pause(200);
    holder.kill();
    await expect(leased).resolves.toBe("ran");
  });

  it("bounds the wait and honours the caller's abort", async () => {
    resetSessionHandoffLeaseGateForTest(300);
    const holder = await liveProcess();
    leaseFor(LEASED, holder.pid!);
    refreshSessionHandoffLeases();
    const started = Date.now();
    await expect(enqueueCommandInLane(LEASED, async () => "ran")).rejects.toBeInstanceOf(
      SessionHandoffLeaseTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(3_000);
    const abort = new AbortController();
    const aborted = enqueueCommandInLane(LEASED, async () => "ran", { abortSignal: abort.signal });
    abort.abort(new Error("caller gave up"));
    await expect(aborted).rejects.toThrow("caller gave up");
  });

  it("finds a lease written after its last scan within the periodic rescan", async () => {
    const holder = await liveProcess();
    refreshSessionHandoffLeases();
    const file = leaseFor(LEASED, holder.pid!);
    await pause(1_100);
    let ran = false;
    const leased = enqueueCommandInLane(LEASED, async () => {
      ran = true;
    });
    await pause(250);
    expect(ran).toBe(false);
    fs.unlinkSync(file);
    await leased;
    expect(ran).toBe(true);
  });

  it("keeps a lease only on sessions with work in flight and releases each when its lane drains", async () => {
    const finish = createDeferred();
    const transcript: string[] = [];
    const busy = enqueueCommandInLane(LEASED, async () => {
      await finish.promise;
      transcript.push("old run final");
    });
    await enqueueCommandInLane(OTHER, async () => {});
    const hold = holdSessionHandoffLeases();
    expect(hold.lanes).toEqual([LEASED]);
    const dir = resolveSessionHandoffLeaseDir();
    expect(fs.existsSync(sessionHandoffLeaseFile(dir, LEASED))).toBe(true);
    expect(fs.existsSync(sessionHandoffLeaseFile(dir, OTHER))).toBe(false);
    await pause(250);
    expect(fs.existsSync(sessionHandoffLeaseFile(dir, LEASED))).toBe(true);
    finish.resolve();
    await busy;
    await hold.released;
    expect(transcript).toEqual(["old run final"]);
    expect(fs.existsSync(sessionHandoffLeaseFile(dir, LEASED))).toBe(false);
  });

  it("a busy previous engine finishes its run after the handoff and only then does the new engine take that session", async () => {
    const transcript = path.join(stateDir, "transcript.txt");
    fs.writeFileSync(transcript, "");
    const queueUrl = pathToFileURL(path.resolve("src/process/command-queue.ts")).href;
    const holderUrl = pathToFileURL(path.resolve("src/process/session-handoff-lease-holder.ts")).href;
    // The previous engine: a run is in flight in LEASED when it steps down; it keeps that session, finishes and
    // saves the run, then releases it and exits.
    const code = `import fs from "node:fs";
import { enqueueCommandInLane } from ${JSON.stringify(queueUrl)};
import { holdSessionHandoffLeases } from ${JSON.stringify(holderUrl)};
const run = enqueueCommandInLane(${JSON.stringify(LEASED)}, async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  fs.appendFileSync(process.env.TRANSCRIPT, "old run final\\n");
});
const hold = holdSessionHandoffLeases();
process.stdout.write(JSON.stringify(hold.lanes) + "\\n");
await run;
await hold.released;`;
    const previous = spawn(process.execPath, ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval", code], {
      cwd: process.cwd(),
      env: { ...process.env, BRANCH_STATE_DIR: stateDir, TRANSCRIPT: transcript },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(previous);
    let stderr = "";
    previous.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const held = await new Promise<string>((resolve, reject) => {
      previous.stdout!.once("data", (chunk: Buffer) => resolve(chunk.toString()));
      previous.once("exit", (code) => reject(new Error(`previous engine exited ${code}: ${stderr}`)));
    });
    expect(JSON.parse(held)).toEqual([LEASED]);
    const exited = new Promise<number | null>((resolve) => previous.once("exit", resolve));

    // The new engine takes over the state now.
    refreshSessionHandoffLeases();
    const nextTurn = enqueueCommandInLane(LEASED, async () => {
      fs.appendFileSync(transcript, "new turn\n");
    });
    await enqueueCommandInLane(OTHER, async () => {});
    expect(fs.readFileSync(transcript, "utf8")).toBe("");
    await nextTurn;
    expect(fs.readFileSync(transcript, "utf8")).toBe("old run final\nnew turn\n");
    await expect(exited).resolves.toBe(0);
  }, 60_000);
});
