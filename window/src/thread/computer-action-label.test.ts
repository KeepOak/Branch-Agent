import { describe, expect, it } from "vitest";
import {
  computerActionLabel,
  computerSafeCaption,
  computerStepDetail,
  computerStepTitle,
  isRawComputerAction,
} from "./computer-action-label";

const KNOWN = [
  ["list_windows", "Listed open windows"],
  ["list_apps", "Listed open apps"],
  ["screenshot", "Took a screenshot"],
  ["click", "Clicked"],
  ["type", "Typed text"],
  ["scroll", "Scrolled"],
  ["focus_window", "Switched windows"],
  ["left_click", "Clicked"],
  ["bring_to_front", "Switched windows"],
] as const;

describe("computer action labels", () => {
  it("maps every listed action to plain words and never returns snake_case", () => {
    for (const [action, label] of KNOWN) {
      expect(computerActionLabel(action)).toBe(label);
      expect(computerActionLabel(action)).not.toMatch(/_/);
    }
  });

  it("falls back for an unknown action and never shows the raw name", () => {
    expect(computerActionLabel("frob_widget")).toBe("Used the computer");
    expect(computerActionLabel("frob_widget")).not.toContain("frob_widget");
    expect(isRawComputerAction("frob_widget")).toBe(true);
    expect(isRawComputerAction("Opened mail")).toBe(false);
  });

  it("rewrites a stored list_windows title and hides it as a detail", () => {
    const step = { title: "list_windows", status: "ok" as const };
    expect(computerStepTitle(step)).toBe("Listed open windows");
    expect(computerStepDetail(step, "Listed open windows")).toBeUndefined();
    expect(computerSafeCaption("list_windows detail")).toBeUndefined();
    expect(computerSafeCaption("Checked what's open on the computer")).toBe("Checked what's open on the computer");
  });
});
