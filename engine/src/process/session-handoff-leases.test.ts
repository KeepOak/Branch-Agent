import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import {
  enqueueCommandInLane,
  GatewayDrainingError,
  getCommandLaneSnapshot,
  getTotalQueueSize,
} from "./command-queue.js";
import { resetCommandQueueStateForTest } from "./command-queue.test-support.js";
import {
  listSessionHandoffLeases,
  readSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
  writeSessionHandoffLease,
} from "./session-handoff-lease-files.js";
import {
  refreshSessionHandoffLeases,
  resetSessionHandoffLeaseGateForTest,
  SessionHandoffLeaseTimeoutError,
} from "./session-handoff-lease-gate.js";
import {
  holdSessionHandoffLeases as startHold,
  isSessionLaneBusy,
  type SessionHandoffLeaseHold,
} from "./session-handoff-lease-holder.js";

const LEASED = "session:agent:main:leased";
const OTHER = "session:agent:main:other";
let stateDir: string;
let previousStateDir: string | undefined;
const children: ChildProcess[] = [];
const holds: SessionHandoffLeaseHold[] = [];
/** Every hold a test starts is released afterwards, so its enqueue hook never leaks into the next test. */
function holdSessionHandoffLeases(...args: Parameters<typeof startHold>): SessionHandoffLeaseHold {
  const hold = startHold(...args);
  holds.push(hold);
  return hold;
}
const leaseFiles = (lane: string) =>
  listSessionHandoffLeases(resolveSessionHandoffLeaseDir(), lane).map(({ file }) => file);

beforeEach(() => {
  resetCommandQueueStateForTest();
  resetSessionHandoffLeaseGateForTest();
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-session-lease-"));
  previousStateDir = process.env.BRANCH_STATE_DIR;
  process.env.BRANCH_STATE_DIR = stateDir;
});

afterEach(async () => {
  vi.useRealTimers();
  for (const hold of holds.splice(0)) hold.releaseAll();
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
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  await new Promise((resolve) => child.once("spawn", resolve));
  return child;
}

/** A lease file exactly as the previous engine would write it, held by `pid` (its real start time by default). */
function leaseFor(lane: string, pid: number, overrides: Record<string, unknown> = {}): string {
  const dir = resolveSessionHandoffLeaseDir();
  const { file, lease } = writeSessionHandoffLease(dir, lane);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...lease, pid, startTime: getFileLockProcessStartTime(pid), ...overrides }),
  );
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

  it("deletes and ignores a stale lease: too old, or a reused PID that is another process now", async () => {
    const other = await liveProcess();
    const expired = leaseFor(LEASED, other.pid!, {
      acquiredAt: Date.now() - SESSION_HANDOFF_LEASE_MAX_AGE_MS - 1_000,
    });
    const reused = leaseFor(OTHER, other.pid!, { startTime: 12_345 });
    refreshSessionHandoffLeases();
    await expect(enqueueCommandInLane(LEASED, async () => "ran")).resolves.toBe("ran");
    await expect(enqueueCommandInLane(OTHER, async () => "ran")).resolves.toBe("ran");
    expect(fs.existsSync(expired)).toBe(false);
    expect(fs.existsSync(reused)).toBe(false);
    // A stale lease never blocks the next step-down either.
    leaseFor(LEASED, other.pid!, { startTime: 12_345 });
    expect(() => writeSessionHandoffLease(resolveSessionHandoffLeaseDir(), LEASED)).not.toThrow();
    // Nor does another holder's live lease: each holder writes its own file.
    leaseFor(OTHER, other.pid!);
    const mine = writeSessionHandoffLease(resolveSessionHandoffLeaseDir(), OTHER);
    expect(leaseFiles(OTHER)).toHaveLength(2);
    expect(readSessionHandoffLease(mine.file)?.pid).toBe(process.pid);
  });

  it("frees waiting work when a held lease outlives any handoff", async () => {
    const holder = await liveProcess();
    leaseFor(LEASED, holder.pid!, {
      acquiredAt: Date.now() - SESSION_HANDOFF_LEASE_MAX_AGE_MS + 400,
    });
    refreshSessionHandoffLeases();
    const started = Date.now();
    await expect(enqueueCommandInLane(LEASED, async () => "ran")).resolves.toBe("ran");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("counts turns parked behind a lease as queued work", async () => {
    const holder = await liveProcess();
    const file = leaseFor(LEASED, holder.pid!);
    refreshSessionHandoffLeases();
    const parked = [
      enqueueCommandInLane(LEASED, async () => {}),
      enqueueCommandInLane(LEASED, async () => {}),
    ];
    expect(getCommandLaneSnapshot(LEASED).queuedCount).toBe(2);
    expect(getTotalQueueSize()).toBe(2);
    fs.unlinkSync(file);
    await Promise.all(parked);
    expect(getCommandLaneSnapshot(LEASED).queuedCount).toBe(0);
  });

  it("keeps a session leased until a run's last write after its lane task ended", async () => {
    let persisting = true;
    const transcript: string[] = [];
    await enqueueCommandInLane(LEASED, async () => {
      transcript.push("run done");
    });
    // The run's final transcript write is still pending outside its lane task.
    const hold = holdSessionHandoffLeases({
      lanes: [LEASED],
      isBusy: (lane) => isSessionLaneBusy(lane) || persisting,
    });
    const [file] = leaseFiles(LEASED);
    await pause(250);
    expect(readSessionHandoffLease(file!)?.lane).toBe(LEASED);
    transcript.push("final transcript saved");
    persisting = false;
    await hold.released;
    expect(fs.existsSync(file!)).toBe(false);
    expect(transcript).toEqual(["run done", "final transcript saved"]);
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
    expect(leaseFiles(LEASED)).toHaveLength(1);
    expect(leaseFiles(OTHER)).toHaveLength(0);
    await pause(250);
    expect(leaseFiles(LEASED)).toHaveLength(1);
    finish.resolve();
    await busy;
    await hold.released;
    expect(transcript).toEqual(["old run final"]);
    expect(leaseFiles(LEASED)).toHaveLength(0);
  });

  it("a turn parked behind a lease runs when the lease expires instead of giving up first", async () => {
    resetSessionHandoffLeaseGateForTest(5_000);
    const holder = await liveProcess();
    // Parked 10 s into a lease whose holder never releases: the expiry frees it, the bounded wait does not reject it.
    leaseFor(LEASED, holder.pid!, {
      acquiredAt: Date.now() - SESSION_HANDOFF_LEASE_MAX_AGE_MS + 600,
    });
    refreshSessionHandoffLeases();
    await expect(enqueueCommandInLane(LEASED, async () => "ran")).resolves.toBe("ran");
  });

  it("gives the holder a deadline at 330 s and reports when its leases expire for successors", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"],
    });
    const startedAt = Date.now();
    const hold = holdSessionHandoffLeases({ lanes: [LEASED], isBusy: () => true });
    expect(hold.expiresAt).toBe(startedAt + SESSION_HANDOFF_LEASE_MAX_AGE_MS);
    let elapsed: boolean | undefined;
    void hold.deadline.then((value) => {
      elapsed = value;
    });
    await vi.advanceTimersByTimeAsync(SESSION_HANDOFF_LEASE_MAX_WAIT_MS - 1);
    expect(elapsed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(elapsed).toBe(true);
    // Still busy: the leases stay until the caller stops that work; they are not silently dropped.
    expect(leaseFiles(LEASED)).toHaveLength(1);
    hold.releaseAll();
    expect(leaseFiles(LEASED)).toHaveLength(0);
  });

  it("a hold released in time reports its deadline as not reached", async () => {
    const hold = holdSessionHandoffLeases({ lanes: [LEASED], isBusy: () => false });
    await hold.released;
    await expect(hold.deadline).resolves.toBe(false);
  });

  it("leases sessions that get work during the step-down, then refuses unheld ones once sealed", async () => {
    const hold = holdSessionHandoffLeases({
      lanes: [],
      leaseNewLanes: true,
      hasPendingWork: () => true,
    });
    const finish = createDeferred();
    const late = enqueueCommandInLane(OTHER, () => finish.promise);
    expect(leaseFiles(OTHER)).toHaveLength(1);
    hold.seal();
    const third = "session:agent:main:third";
    await expect(enqueueCommandInLane(third, async () => "ran")).rejects.toBeInstanceOf(
      GatewayDrainingError,
    );
    expect(leaseFiles(third)).toHaveLength(0);
    // A session the hold keeps still takes its own follow-up work.
    const followUp = enqueueCommandInLane(OTHER, async () => "follow-up");
    finish.resolve();
    await late;
    await expect(followUp).resolves.toBe("follow-up");
  });

  it("still refuses unheld sessions when sealed after the hold already finished", async () => {
    const hold = holdSessionHandoffLeases({ lanes: [] });
    await hold.released;
    hold.seal();
    await expect(enqueueCommandInLane(OTHER, async () => "ran")).rejects.toBeInstanceOf(
      GatewayDrainingError,
    );
    expect(leaseFiles(OTHER)).toHaveLength(0);
  });

  it("does not stay open for a lease it could not remove, and keeps retrying it gently until it is gone", async () => {
    let busy = true;
    const hold = holdSessionHandoffLeases({ lanes: [LEASED], isBusy: () => busy });
    const [file] = leaseFiles(LEASED);
    const unlink = fs.unlinkSync;
    let attempts = 0;
    // Antivirus holds the file for a while: every removal fails, past the immediate retries.
    const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target) !== file) return unlink(target);
      attempts += 1;
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    busy = false;
    // The session is done here: the hold releases, and the file goes stale for successors once this engine exits.
    await hold.released;
    expect(fs.existsSync(file)).toBe(true);
    // Retries back off, one quick attempt at a time, instead of blocking every tick.
    await pause(1_000);
    expect(attempts).toBeLessThan(12);
    spy.mockRestore();
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it("keeps retrying a lease it could not remove after releaseAll", async () => {
    const hold = holdSessionHandoffLeases({ lanes: [LEASED], isBusy: () => true });
    const [file] = leaseFiles(LEASED);
    const unlink = fs.unlinkSync;
    const spy = vi.spyOn(fs, "unlinkSync").mockImplementation((target) => {
      if (String(target) === file) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      unlink(target);
    });
    hold.releaseAll();
    expect(fs.existsSync(file)).toBe(true);
    spy.mockRestore();
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(false), {
      timeout: 10_000,
      interval: 100,
    });
  });

  it("never waits on a successor's lease for a session it still finishes (A, then B, then C)", async () => {
    // This engine (A) steps down with a run in flight on LEASED.
    const finish = createDeferred();
    const inFlight = enqueueCommandInLane(LEASED, () => finish.promise);
    const hold = holdSessionHandoffLeases({ lanes: [LEASED], hasPendingWork: () => true });
    // A predecessor of A still holds OTHER. A only learns of it now, after its own hold started, but the lease was
    // written before: it still holds A's work there.
    const predecessor = await liveProcess();
    const predecessorLease = leaseFor(OTHER, predecessor.pid!, { acquiredAt: Date.now() - 1_000 });
    // A's successor (B) parks a turn for LEASED behind A, then steps down for C itself and leases LEASED.
    const successor = await liveProcess();
    leaseFor(LEASED, successor.pid!);
    refreshSessionHandoffLeases();
    // A finishes the run, and the run queues follow-up work into LEASED: it runs, never parked behind B (who
    // waits for A), so neither waits out the deadline.
    finish.resolve();
    await inFlight;
    const followUp = enqueueCommandInLane(LEASED, async () => "follow-up");
    await expect(
      Promise.race([followUp, pause(2_000).then(() => "parked behind the successor")]),
    ).resolves.toBe("follow-up");
    // The predecessor's lease still holds A's work for OTHER.
    let ranOther = false;
    const other = enqueueCommandInLane(OTHER, async () => {
      ranOther = true;
    });
    await pause(300);
    expect(ranOther).toBe(false);
    fs.unlinkSync(predecessorLease);
    await other;
    hold.releaseAll();
  });

  it("reads a holder's lease that is briefly unreadable as still held", async () => {
    const holder = await liveProcess();
    const file = leaseFor(LEASED, holder.pid!);
    refreshSessionHandoffLeases();
    const read = fs.readFileSync;
    // An indexer opens the lease file exclusively for a while.
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((
      target: fs.PathOrFileDescriptor,
      ...rest: unknown[]
    ) => {
      if (String(target) === file) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return (read as (...args: unknown[]) => unknown)(target, ...rest);
    }) as typeof fs.readFileSync);
    let ran = false;
    const parked = enqueueCommandInLane(LEASED, async () => {
      ran = true;
    });
    await pause(400);
    expect(ran).toBe(false);
    spy.mockRestore();
    fs.unlinkSync(file);
    await parked;
    expect(ran).toBe(true);
  });

  it("clears its own-hold record only for itself, never for a newer hold", async () => {
    const first = holdSessionHandoffLeases({ lanes: [] });
    await first.released;
    first.releaseAll();
    await pause(5);
    const second = holdSessionHandoffLeases({ lanes: [], hasPendingWork: () => true });
    // A stale handle released again must not wipe the newer hold's start.
    first.releaseAll();
    const successor = await liveProcess();
    leaseFor(LEASED, successor.pid!);
    refreshSessionHandoffLeases();
    await expect(
      Promise.race([
        enqueueCommandInLane(LEASED, async () => "ran"),
        pause(1_000).then(() => "parked behind the successor"),
      ]),
    ).resolves.toBe("ran");
    second.releaseAll();
  });

  it("waits for pending work that is not tied to a session yet", async () => {
    let pending = true;
    const hold = holdSessionHandoffLeases({ lanes: [], hasPendingWork: () => pending });
    let released = false;
    void hold.released.then(() => {
      released = true;
    });
    await pause(250);
    expect(released).toBe(false);
    pending = false;
    await hold.released;
  });

  it("back-to-back updates: B keeps a session it has a turn parked on behind A, and C runs it only after both", async () => {
    const transcript = path.join(stateDir, "transcript.txt");
    fs.writeFileSync(transcript, "");
    const queueUrl = pathToFileURL(path.resolve("src/process/command-queue.ts")).href;
    const holderUrl = pathToFileURL(
      path.resolve("src/process/session-handoff-lease-holder.ts"),
    ).href;
    const header = `import fs from "node:fs";
import { enqueueCommandInLane } from ${JSON.stringify(queueUrl)};
import { holdSessionHandoffLeases } from ${JSON.stringify(holderUrl)};
const say = (line) => process.stdout.write(line + "\\n");
const stdinLine = () => new Promise((resolve) => process.stdin.once("data", resolve));
process.stdin.resume();`;
    // A: its run in LEASED finishes when told to; it keeps the session until then.
    const engineA = `${header}
const run = enqueueCommandInLane(${JSON.stringify(LEASED)}, async () => {
  await stdinLine();
  fs.appendFileSync(process.env.TRANSCRIPT, "A final\\n");
});
const hold = holdSessionHandoffLeases();
say("A " + JSON.stringify(hold.lanes));
await run; await hold.released; say("A released");
await new Promise((resolve) => process.stdin.once("end", resolve));`;
    // B: took over from A; a turn for LEASED parks behind A's lease. Then B steps down for C.
    const engineB = `${header}
const parked = enqueueCommandInLane(${JSON.stringify(LEASED)}, async () => {
  fs.appendFileSync(process.env.TRANSCRIPT, "B turn\\n");
});
await new Promise((resolve) => setTimeout(resolve, 300));
const hold = holdSessionHandoffLeases();
say("B " + JSON.stringify(hold.lanes));
await parked; await hold.released; say("B released");
await new Promise((resolve) => process.stdin.once("end", resolve));`;
    const start = (name: string, code: string) => {
      const child = spawn(
        process.execPath,
        ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval", code],
        {
          cwd: process.cwd(),
          env: { ...process.env, BRANCH_STATE_DIR: stateDir, TRANSCRIPT: transcript },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      children.push(child);
      const io = { out: "", err: "" };
      child.stdout!.on("data", (chunk: Buffer) => (io.out += chunk.toString()));
      child.stderr!.on("data", (chunk: Buffer) => (io.err += chunk.toString()));
      const waitFor = (text: string) =>
        vi.waitFor(
          () => {
            if (child.exitCode !== null) throw new Error(`${name} exited: ${io.err}`);
            expect(io.out).toContain(text);
          },
          { timeout: 30_000, interval: 20 },
        );
      return { child, io, waitFor };
    };
    const a = start("A", engineA);
    await a.waitFor(`A ["${LEASED}"]`);
    const b = start("B", engineB);
    // B steps down while A still holds LEASED: no "already leased", and B keeps the session for its parked turn.
    await b.waitFor(`B ["${LEASED}"]`);
    expect(
      new Set(
        listSessionHandoffLeases(resolveSessionHandoffLeaseDir(), LEASED).map(
          ({ lease }) => lease.pid,
        ),
      ),
    ).toEqual(new Set([a.child.pid, b.child.pid]));

    // C takes over now.
    refreshSessionHandoffLeases();
    let bLeasesWhenCRan = -1;
    const cTurn = enqueueCommandInLane(LEASED, async () => {
      bLeasesWhenCRan = listSessionHandoffLeases(resolveSessionHandoffLeaseDir(), LEASED).filter(
        ({ lease }) => lease.pid === b.child.pid,
      ).length;
      fs.appendFileSync(transcript, "C turn\n");
    });
    await pause(300);
    expect(fs.readFileSync(transcript, "utf8")).toBe("");
    a.child.stdin!.write("finish\n");
    await cTurn;
    expect(fs.readFileSync(transcript, "utf8")).toBe("A final\nB turn\nC turn\n");
    expect(bLeasesWhenCRan).toBe(0);
    // Freed by both releases while A and B were still running. Each says so right after removing its lease, and
    // that line can reach us a little after C's turn ran (slow runners).
    await a.waitFor("A released");
    await b.waitFor("B released");
    expect(a.child.exitCode).toBeNull();
    expect(b.child.exitCode).toBeNull();
    a.child.stdin!.end();
    b.child.stdin!.end();
  }, 90_000);

  it("a busy previous engine finishes its run after the handoff and only then does the new engine take that session", async () => {
    const transcript = path.join(stateDir, "transcript.txt");
    fs.writeFileSync(transcript, "");
    const queueUrl = pathToFileURL(path.resolve("src/process/command-queue.ts")).href;
    const holderUrl = pathToFileURL(
      path.resolve("src/process/session-handoff-lease-holder.ts"),
    ).href;
    // The previous engine: a run is in flight in LEASED when it steps down; it keeps that session, finishes and
    // saves the run, then releases it and exits.
    const code = `import fs from "node:fs";
import { enqueueCommandInLane } from ${JSON.stringify(queueUrl)};
import { holdSessionHandoffLeases } from ${JSON.stringify(holderUrl)};
const run = enqueueCommandInLane(${JSON.stringify(LEASED)}, async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  fs.appendFileSync(process.env.TRANSCRIPT, "old run final\\n");
});
const hold = holdSessionHandoffLeases();
process.stdout.write(JSON.stringify(hold.lanes) + "\\n");
await run;
await hold.released;
process.stdout.write("released\\n");
// Stay alive after releasing: the successor must be freed by the release itself, not by this process dying.
await new Promise((resolve) => process.stdin.once("end", resolve).resume());`;
    const previous = spawn(
      process.execPath,
      ["--import", "./scripts/tsx.mjs", "--input-type=module", "--eval", code],
      {
        cwd: process.cwd(),
        env: { ...process.env, BRANCH_STATE_DIR: stateDir, TRANSCRIPT: transcript },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    children.push(previous);
    let stdout = "";
    previous.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    let stderr = "";
    previous.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await vi.waitFor(
      () => {
        if (previous.exitCode !== null) throw new Error(`previous engine exited: ${stderr}`);
        expect(stdout).toContain("\n");
      },
      { timeout: 30_000, interval: 20 },
    );
    expect(JSON.parse(stdout.split("\n")[0]!)).toEqual([LEASED]);
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
    // Freed by the release while the previous engine was still running. It says so right after removing its lease,
    // and that line can reach us a little after the new turn ran (slow runners).
    await vi.waitFor(() => expect(stdout).toContain("released"), { timeout: 10_000, interval: 20 });
    expect(previous.exitCode).toBeNull();
    previous.stdin!.end();
    await expect(exited).resolves.toBe(0);
  }, 60_000);
});
