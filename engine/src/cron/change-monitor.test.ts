import { describe, expect, it } from "vitest";
import { buildChangeMonitorDecision } from "./change-monitor.js";
import { parseTriggerResult } from "./trigger-script-result.js";

function completed(value: unknown, output: unknown[] = []) {
  return { status: "completed" as const, value, output, toolCallCount: 0 };
}

describe("quiet change monitoring", () => {
  it("establishes a silent baseline, survives serialized restart, fires on change once", () => {
    const first = parseTriggerResult(
      completed({ observe: { release: "v1", checks: ["passed"] }, state: { cursor: 1 } }),
    );
    expect(first).toMatchObject({ kind: "evaluated", fire: false, state: { data: { cursor: 1 } } });
    if (first.kind !== "evaluated") {
      throw new Error("baseline failed");
    }
    const restartedState: unknown = JSON.parse(JSON.stringify(first.state));
    expect(
      parseTriggerResult(
        completed({ observe: { checks: ["passed"], release: "v1" } }),
        restartedState,
      ),
    ).toMatchObject({ kind: "evaluated", fire: false });
    expect(
      parseTriggerResult(
        completed({ observe: { release: "v1", checks: ["passed"] } }),
        restartedState,
      ),
    ).toMatchObject({ state: { data: { cursor: 1 } } });
    const changed = parseTriggerResult(
      completed({ observe: { release: "v2", checks: ["passed"] }, message: "New release" }),
      restartedState,
    );
    expect(changed).toMatchObject({ kind: "evaluated", fire: true, message: "New release" });
    if (changed.kind !== "evaluated") {
      throw new Error("change failed");
    }
    expect(
      parseTriggerResult(
        completed({ observe: { release: "v2", checks: ["passed"] } }),
        changed.state,
      ),
    ).toMatchObject({ kind: "evaluated", fire: false });
    expect(JSON.stringify(first.state)).not.toContain("release");
  });
  it("supports an explicit first notification and preserves ordered arrays", () => {
    expect(buildChangeMonitorDecision({ observe: "ready", notifyOnFirst: true }).fire).toBe(true);
    const first = buildChangeMonitorDecision({ observe: [1, 2] });
    expect(buildChangeMonitorDecision({ observe: [2, 1], previousState: first.state }).fire).toBe(
      true,
    );
  });
  it("ignores trailing diagnostics without overriding a malformed explicit decision", () => {
    expect(
      parseTriggerResult(
        completed(undefined, [
          { type: "json", value: { observe: "ready" } },
          { type: "json", value: { diagnostic: "inspected" } },
        ]),
      ),
    ).toMatchObject({ kind: "evaluated", fire: false });
    expect(parseTriggerResult(completed({ observe: "ready", fire: false }))).toMatchObject({
      kind: "error",
    });
    expect(parseTriggerResult(completed({ observe: "ready", notifyOnFirst: "yes" }))).toMatchObject(
      { kind: "error" },
    );
    expect(parseTriggerResult(completed({ fire: true, state: { cursor: 1 } }))).toEqual({
      kind: "evaluated",
      fire: true,
      state: { cursor: 1 },
    });
  });
  it("rejects unsupported observations and oversized custom state", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const observe of [undefined, NaN, 1n, circular, new Date(), { nested: undefined }]) {
      expect(parseTriggerResult(completed({ observe }))).toMatchObject({ kind: "error" });
    }
    expect(
      parseTriggerResult(completed({ observe: "ok", state: "x".repeat(17000) })),
    ).toMatchObject({ kind: "error" });
  });
});
