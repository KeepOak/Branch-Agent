import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let failPreparation = false;

vi.mock("../state/branch-state-db-readonly.js", () => ({
  withArtifactPreservingStateReads: <T>(operation: () => T): T => {
    calls.push("artifact-preserving");
    return operation();
  },
  withBranchStateDatabaseReadSnapshot: async <T>(operation: () => Promise<T>): Promise<T> => {
    calls.push("snapshot");
    if (failPreparation) {
      throw new Error("Cannot read shared state for discovery: test");
    }
    return await operation();
  },
}));

const { withStatusStateSnapshot } = await import("./status.state-snapshot.js");

describe("withStatusStateSnapshot", () => {
  beforeEach(() => {
    calls.length = 0;
    failPreparation = false;
  });

  it("serves the whole status run from one artifact-preserving snapshot", async () => {
    const operation = vi.fn(async () => {
      calls.push("operation");
      return "report";
    });
    await expect(withStatusStateSnapshot(operation)).resolves.toBe("report");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["artifact-preserving", "snapshot", "operation"]);
  });

  it("still runs status once when the snapshot cannot be prepared", async () => {
    failPreparation = true;
    const operation = vi.fn(async () => "report");
    await expect(withStatusStateSnapshot(operation)).resolves.toBe("report");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not rerun status when status itself fails", async () => {
    const operation = vi.fn(async () => {
      throw new Error("scan failed");
    });
    await expect(withStatusStateSnapshot(operation)).rejects.toThrow("scan failed");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
