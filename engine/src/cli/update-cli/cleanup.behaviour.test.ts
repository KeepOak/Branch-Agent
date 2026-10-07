// Written by Branch for OPS-0057 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/cli/update-cli/cleanup.ts; verifies the production cleanup command's retirement boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryCleanupReport } from "../../commands/doctor-session-sqlite-recovery-inventory.js";
import { updateCleanupCommand } from "./cleanup.js";

const boundary = vi.hoisted(() => ({
  inspect: vi.fn(),
  retire: vi.fn(),
  readConfig: vi.fn(),
  confirm: vi.fn(),
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
  json: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({ confirm: boundary.confirm }));
vi.mock("../../commands/doctor-session-sqlite-recovery-inventory.js", () => ({
  inspectSessionSqliteRecovery: boundary.inspect,
}));
vi.mock("../../commands/doctor-session-sqlite-retirement.js", () => ({
  retireSessionSqliteRecovery: boundary.retire,
}));
vi.mock("../../config/io.js", () => ({ readSourceConfigBestEffort: boundary.readConfig }));
vi.mock("../../runtime.js", () => ({
  defaultRuntime: { log: boundary.log, error: boundary.error, exit: boundary.exit },
  writeRuntimeJson: boundary.json,
}));

function report(status: RecoveryCleanupReport["status"] = "preview"): RecoveryCleanupReport {
  return {
    stateDir: "/scratch/recovery",
    artifacts: [
      {
        path: "/scratch/recovery/original",
        runs: ["verified"],
        bytes: 32,
        outcome: "candidate",
        reason: "verified-update",
      },
    ],
    totals: {
      candidateBytes: 32,
      verificationRequiredBytes: 0,
      protectedBytes: 0,
      blockedBytes: 0,
      removedBytes: 0,
      removedFiles: 0,
    },
    status,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.readConfig.mockResolvedValue({});
  boundary.inspect.mockReturnValue(report());
  boundary.retire.mockResolvedValue(report("complete"));
});

describe("update recovery cleanup command", () => {
  it("previews recovery originals without granting deletion authority", async () => {
    await updateCleanupCommand({ dryRun: true, json: true, yes: true });
    expect(boundary.inspect).toHaveBeenCalledWith({ cfg: {}, env: process.env });
    expect(boundary.retire).not.toHaveBeenCalled();
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), { ...report(), dryRun: true });
    expect(boundary.exit).not.toHaveBeenCalled();
  });

  it("refuses unattended JSON cleanup without explicit acknowledgement", async () => {
    await updateCleanupCommand({ json: true });
    expect(boundary.retire).not.toHaveBeenCalled();
    expect(boundary.confirm).not.toHaveBeenCalled();
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), {
      ...report("refused"),
      dryRun: false,
    });
    expect(boundary.error).toHaveBeenCalledWith(expect.stringContaining("--yes"));
    expect(boundary.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("delegates acknowledged cleanup to the verified retirement service", async () => {
    await updateCleanupCommand({ yes: true, json: true });
    expect(boundary.retire).toHaveBeenCalledExactlyOnceWith({
      env: process.env,
      preview: report(),
      readConfig: boundary.readConfig,
      confirm: expect.any(Function),
    });
    const confirmation = boundary.retire.mock.calls[0]![0].confirm as (
      verified: RecoveryCleanupReport,
    ) => Promise<boolean>;
    expect(await confirmation(report())).toBe(true);
    expect(boundary.confirm).not.toHaveBeenCalled();
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), {
      ...report("complete"),
      dryRun: false,
    });
    expect(boundary.exit).not.toHaveBeenCalled();
  });

  it("completes an empty inventory without prompting or retiring", async () => {
    boundary.inspect.mockReturnValue({ ...report(), artifacts: [] });
    await updateCleanupCommand({ json: true });
    expect(boundary.retire).not.toHaveBeenCalled();
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), {
      ...report("complete"),
      artifacts: [],
      dryRun: false,
    });
    expect(boundary.exit).not.toHaveBeenCalled();
  });

  it.each(["blocked", "refused"] as const)("reports %s retirement as failure", async (status) => {
    boundary.retire.mockResolvedValue(report(status));
    await updateCleanupCommand({ yes: true, json: true });
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), {
      ...report(status),
      dryRun: false,
    });
    expect(boundary.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("preserves inventory diagnostics when retirement throws", async () => {
    boundary.retire.mockRejectedValue(new Error("verification lost"));
    await updateCleanupCommand({ yes: true, json: true });
    expect(boundary.json).toHaveBeenCalledWith(expect.anything(), {
      ...report("blocked"),
      error: "Error: verification lost",
    });
    expect(boundary.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("renders the rollback consequence and removal totals", async () => {
    boundary.retire.mockResolvedValue({
      ...report("complete"),
      totals: { ...report().totals, removedBytes: 32, removedFiles: 1 },
    });
    await updateCleanupCommand({ yes: true });
    expect(boundary.log).toHaveBeenCalledWith(
      expect.stringContaining("permanently loses rollback"),
    );
    expect(boundary.log).toHaveBeenCalledWith("Removed 1 files (32 logical bytes).");
  });
});
