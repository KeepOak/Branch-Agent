import { afterEach, expect, it, vi } from "vitest";
import { defaultRuntime } from "../../runtime.js";
import { summarizeUpdateRehearsal, updateRehearseCommand } from "./update-command-rehearse.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const step = (name: string, exitCode: number | null, stderrTail?: string) => ({
  name,
  command: name,
  cwd: "/candidate",
  durationMs: 1,
  exitCode,
  stderrTail,
});

it("passes only when the copied state reached readiness with a clean startup", () => {
  expect(
    summarizeUpdateRehearsal("startup-only", {
      status: "ok",
      phase: "readiness",
      durationMs: 5,
      logTail: [],
      steps: [step("candidate-state-snapshot", 0), step("candidate-gateway-startup", 0)],
    }),
  ).toEqual({ outcome: "passed", policy: "startup-only", phase: "readiness", durationMs: 5 });
  // An older candidate without the isolated runtime only reaches "runtime": not proven.
  expect(
    summarizeUpdateRehearsal("rehearse", {
      status: "ok",
      phase: "runtime",
      durationMs: 5,
      logTail: [],
      steps: [],
    }).outcome,
  ).toBe("refused");
});

it("names the failing check and its last line, e.g. an invalid session row on the copy", () => {
  expect(
    summarizeUpdateRehearsal("startup-only", {
      status: "error",
      reason: "runtime-verification-failed",
      phase: "startup",
      durationMs: 9,
      logTail: [],
      steps: [
        step("candidate-state-snapshot", 0),
        step(
          "candidate-gateway-startup",
          1,
          "booting\ninvalid persisted session row requires repair for agent:main:x; stop the Gateway and run branch doctor --fix\n",
        ),
      ],
    }),
  ).toEqual({
    outcome: "refused",
    policy: "startup-only",
    phase: "startup",
    durationMs: 9,
    failedStep: "candidate-gateway-startup",
    detail:
      "invalid persisted session row requires repair for agent:main:x; stop the Gateway and run branch doctor --fix",
  });
});

it("rehearses against the serving state dir with the requested policy and prints one JSON result", async () => {
  const written: unknown[] = [];
  vi.spyOn(defaultRuntime, "writeJson").mockImplementation((value) => written.push(value));
  const exit = vi.spyOn(defaultRuntime, "exit").mockImplementation(() => undefined as never);
  const validate = vi.fn(async () => ({
    status: "ok" as const,
    phase: "readiness" as const,
    durationMs: 3,
    logTail: [],
    steps: [step("candidate-gateway-startup", 0)],
  }));
  const env = { BRANCH_STATE_DIR: "/live/state" };
  await updateRehearseCommand(
    { repair: true },
    { validate, env, readConfig: async () => ({}), resolveRoot: async () => "/candidate" },
  );
  expect(validate).toHaveBeenCalledWith(
    expect.objectContaining({
      root: "/candidate",
      stateDir: "/live/state",
      migrationPolicy: "rehearse",
    }),
  );
  expect(written).toEqual([expect.objectContaining({ outcome: "passed", policy: "rehearse" })]);
  expect(exit).not.toHaveBeenCalled();
});

it("exits 1 with a refused result when the snapshot itself cannot be prepared", async () => {
  const written: unknown[] = [];
  vi.spyOn(defaultRuntime, "writeJson").mockImplementation((value) => written.push(value));
  const exit = vi.spyOn(defaultRuntime, "exit").mockImplementation(() => undefined as never);
  await updateRehearseCommand(
    { repair: false },
    {
      validate: async () => {
        throw new Error("snapshot-capacity-insufficient: free 2 GB");
      },
      env: { BRANCH_STATE_DIR: "/live/state" },
      readConfig: async () => ({}),
      resolveRoot: async () => "/candidate",
    },
  );
  expect(written).toEqual([
    expect.objectContaining({
      outcome: "refused",
      policy: "startup-only",
      failedStep: "candidate-rehearsal",
      detail: "snapshot-capacity-insufficient: free 2 GB",
    }),
  ]);
  expect(exit).toHaveBeenCalledWith(1);
});
