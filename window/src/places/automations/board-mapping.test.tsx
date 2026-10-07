import { describe, it, expect } from "vitest";
import { statusToColumn, columnToStatus, moveDisabledReason, type CanopyStatus, type BoardCol } from "./board-mapping";

describe("statusToColumn", () => {
  it("maps triage to sort", () => {
    expect(statusToColumn("triage")).toBe("sort");
  });

  it("maps backlog, todo, and scheduled to todo", () => {
    expect(statusToColumn("backlog")).toBe("todo");
    expect(statusToColumn("todo")).toBe("todo");
    expect(statusToColumn("scheduled")).toBe("todo");
  });

  it("maps ready and running to doing", () => {
    expect(statusToColumn("ready")).toBe("doing");
    expect(statusToColumn("running")).toBe("doing");
  });

  it("maps review to check", () => {
    expect(statusToColumn("review")).toBe("check");
  });

  it("maps done to done", () => {
    expect(statusToColumn("done")).toBe("done");
  });

  it("maps blocked to stuck", () => {
    expect(statusToColumn("blocked")).toBe("stuck");
  });

  it("covers all Canopy statuses", () => {
    const allStatuses: CanopyStatus[] = ["triage", "backlog", "todo", "scheduled", "ready", "running", "review", "blocked", "done"];
    allStatuses.forEach(status => {
      expect(() => statusToColumn(status)).not.toThrow();
      expect(statusToColumn(status)).toMatch(/^(sort|todo|doing|check|done|stuck)$/);
    });
  });
});

describe("columnToStatus", () => {
  it("maps sort to triage", () => {
    expect(columnToStatus("sort")).toBe("triage");
  });

  it("maps todo to todo", () => {
    expect(columnToStatus("todo")).toBe("todo");
  });

  it("maps doing to running", () => {
    expect(columnToStatus("doing")).toBe("running");
  });

  it("maps check to review", () => {
    expect(columnToStatus("check")).toBe("review");
  });

  it("maps done to done", () => {
    expect(columnToStatus("done")).toBe("done");
  });

  it("maps stuck to blocked", () => {
    expect(columnToStatus("stuck")).toBe("blocked");
  });

  it("covers all Board columns", () => {
    const allCols: BoardCol[] = ["sort", "todo", "doing", "check", "done", "stuck"];
    allCols.forEach(col => {
      const result = columnToStatus(col);
      expect(result).not.toBeNull();
      expect(typeof result).toBe("string");
    });
  });
});

describe("moveDisabledReason", () => {
  it("returns null for all columns since all moves are supported", () => {
    const allCols: BoardCol[] = ["sort", "todo", "doing", "check", "done", "stuck"];
    allCols.forEach(col => {
      expect(moveDisabledReason(col)).toBeNull();
    });
  });
});

describe("round-trip mapping", () => {
  it("ensures columnToStatus result can map back to a column", () => {
    const allCols: BoardCol[] = ["sort", "todo", "doing", "check", "done", "stuck"];
    allCols.forEach(col => {
      const status = columnToStatus(col);
      expect(status).not.toBeNull();
      if (status) {
        const backToCol = statusToColumn(status);
        expect(backToCol).toBeTruthy();
      }
    });
  });
});
