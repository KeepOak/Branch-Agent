import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import type { AgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";
import { waitForPreviousEngineRelease } from "../state/agent-database-startup.stages.js";
import {
  resolveSessionHandoffLeaseDir,
  writeSessionHandoffLease,
} from "./session-handoff-lease-files.js";
import {
  listPredecessorAgentLanes,
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
  waitForPredecessorAgentLeases,
} from "./session-handoff-lease-gate.js";

let stateDir: string;
let previousStateDir: string | undefined;
const children: ChildProcess[] = [];

beforeEach(() => {
  resetSessionHandoffLeaseGateForTest();
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-agent-lease-wait-"));
  previousStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = stateDir;
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((resolve) => {
        child.once("exit", resolve);
      });
    }
  }
  resetSessionHandoffLeaseGateForTest();
  if (previousStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = previousStateDir;
  }
  fs.rmSync(stateDir, { recursive: true, force: true });
});

/** Another live process standing in for the previous engine. */
async function previousEngine(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  await new Promise((resolve) => {
    child.once("spawn", resolve);
  });
  return child;
}

/** A lease file exactly as the previous engine writes it for a kept session. */
function leaseFor(lane: string, pid: number): string {
  const { file, lease } = writeSessionHandoffLease(resolveSessionHandoffLeaseDir(), lane);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...lease, pid, startTime: getFileLockProcessStartTime(pid) }),
  );
  return file;
}

const pause = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("agent database inspection waits for the previous engine's leases (#951)", () => {
  it("starts at once when the previous engine holds nothing of the agent", async () => {
    const holder = await previousEngine();
    leaseFor("session:agent:other:main", holder.pid!);
    refreshSessionHandoffLeases();
    let waited = false;
    await waitForPredecessorAgentLeases("main", { onWaiting: () => (waited = true) });
    expect(waited).toBe(false);
  });

  it("waits while the lease is held and starts right after the release", async () => {
    const holder = await previousEngine();
    const file = leaseFor("session:agent:main:kept-run", holder.pid!);
    refreshSessionHandoffLeases();
    expect(listPredecessorAgentLanes("main")).toEqual(["session:agent:main:kept-run"]);
    const lanesSeen: string[][] = [];
    let done = false;
    const wait = waitForPredecessorAgentLeases("main", {
      onWaiting: (lanes) => lanesSeen.push(lanes),
    }).then((result) => {
      done = true;
      return result;
    });
    await pause(1_500);
    expect(done).toBe(false);
    expect(lanesSeen).toEqual([["session:agent:main:kept-run"]]);
    fs.unlinkSync(file);
    const { waitedMs } = await wait;
    expect(waitedMs).toBeGreaterThanOrEqual(1_500);
    expect(listPredecessorAgentLanes("main")).toEqual([]);
  });

  it("stops waiting when the previous engine dies without releasing", async () => {
    const holder = await previousEngine();
    leaseFor("session:agent:main:kept-run", holder.pid!);
    refreshSessionHandoffLeases();
    const wait = waitForPredecessorAgentLeases("main");
    await pause(200);
    holder.kill();
    await expect(wait).resolves.toMatchObject({ waitedMs: expect.any(Number) });
  });

  it("tells a timed-out preparation stage to wait for the release and retry, not count a failure", async () => {
    const refusal = { reason: "" } as AgentDatabaseAdmissionRefusal;
    const signal = new AbortController().signal;
    const params = { agentId: "main", refusal, statusReason: "Agent main is preparing.", signal };
    await expect(waitForPreviousEngineRelease(params)).resolves.toBe("free");
    const holder = await previousEngine();
    const file = leaseFor("session:agent:main:kept-run", holder.pid!);
    refreshSessionHandoffLeases();
    const wait = waitForPreviousEngineRelease(params);
    await pause(300);
    expect(refusal.reason).toBe(
      "Agent main is preparing. Stage: waiting for the previous engine to release it.",
    );
    fs.unlinkSync(file);
    await expect(wait).resolves.toBe("waited");
  });

  it("ends the wait when startup stops", async () => {
    const holder = await previousEngine();
    leaseFor("session:agent:main:kept-run", holder.pid!);
    refreshSessionHandoffLeases();
    const controller = new AbortController();
    const wait = waitForPredecessorAgentLeases("main", { signal: controller.signal });
    controller.abort(new Error("Gateway stopped during agent database inspection"));
    await expect(wait).rejects.toThrow("Gateway stopped during agent database inspection");
  });
});
