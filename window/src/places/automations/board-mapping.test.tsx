import { describe, expect, it } from "vitest";
import { BOARD_COLUMNS, colName, columnToStatus, statusToColumn, type BoardCol } from "./board-mapping";

describe("statusToColumn", () => {
  it("maps each Canopy status onto the Board column the preview uses", () => {
    expect(statusToColumn("triage")).toBe("sort");
    expect(statusToColumn("backlog")).toBe("todo");
    expect(statusToColumn("todo")).toBe("todo");
    expect(statusToColumn("scheduled")).toBe("todo");
    expect(statusToColumn("ready")).toBe("doing");
    expect(statusToColumn("running")).toBe("doing");
    expect(statusToColumn("review")).toBe("check");
    expect(statusToColumn("done")).toBe("done");
    expect(statusToColumn("blocked")).toBe("stuck");
  });

  it("returns null for a status the Board does not show", () => {
    expect(statusToColumn("")).toBeNull();
    expect(statusToColumn("unknown")).toBeNull();
  });
});

describe("columnToStatus", () => {
  it("picks the canopy.cards.move status for each column", () => {
    expect(columnToStatus("sort")).toBe("triage");
    expect(columnToStatus("todo")).toBe("todo");
    expect(columnToStatus("doing")).toBe("running");
    expect(columnToStatus("check")).toBe("review");
    expect(columnToStatus("done")).toBe("done");
    expect(columnToStatus("stuck")).toBe("blocked");
  });

  it("round-trips every Board column through a real Canopy status", () => {
    for (const [col, name] of BOARD_COLUMNS) {
      expect(colName(col)).toBe(name);
      expect(statusToColumn(columnToStatus(col as BoardCol))).toBe(col);
    }
  });
});
