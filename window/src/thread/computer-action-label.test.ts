import { describe, expect, it } from "vitest";
import {
  computerActionLabel,
  computerSafeCaption,
  computerStepDetail,
  computerStepTitle,
  isComputerToolName,
  isRawComputerAction,
  isScreenToolName,
  plainStepTitle,
  screenActionLabel,
  screenStepTitle,
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

const SCREEN = [
  ["split_right", "Split the screen"],
  ["split_down", "Split the screen down"],
  ["close_pane", "Closed a pane"],
  ["focus", "Focused a pane"],
  ["sidebar_show", "Showed the sidebar"],
  ["sidebar_hide", "Hid the sidebar"],
  ["terminal_show", "Showed the terminal"],
  ["terminal_hide", "Hid the terminal"],
  ["browser_show", "Showed the browser"],
  ["browser_hide", "Hid the browser"],
  ["desktop_show", "Showed the desktop"],
  ["desktop_hide", "Hid the desktop"],
  ["portal_show", "Showed a portal"],
  ["portal_hide", "Hid a portal"],
  ["navigate", "Opened a view"],
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

describe("screen action labels", () => {
  it("treats only the computer tool as computer, never screen or desktop", () => {
    expect(isComputerToolName("computer")).toBe(true);
    expect(isComputerToolName("plugin.computer")).toBe(true);
    expect(isComputerToolName("screen")).toBe(false);
    expect(isComputerToolName("plugin.screen")).toBe(false);
    expect(isComputerToolName("desktop")).toBe(false);
    expect(isScreenToolName("screen")).toBe(true);
    expect(isScreenToolName("plugin.screen")).toBe(true);
    expect(isScreenToolName("computer")).toBe(false);
  });

  it("maps every screen-tool action to its own plain words and never the computer fallback", () => {
    for (const [action, label] of SCREEN) {
      expect(screenActionLabel(action)).toBe(label);
      expect(screenActionLabel(action)).not.toBe("Used the computer");
      expect(screenActionLabel(action)).not.toMatch(/_/);
      expect(plainStepTitle({ tool: "screen", title: action, status: "ok" })).toBe(label);
    }
  });

  it("falls back only for an unknown screen action and never shows the raw name", () => {
    expect(screenActionLabel("frob_pane")).toBe("Used the screen");
    expect(screenActionLabel("frob_pane")).not.toBe("Used the computer");
    expect(screenActionLabel("frob_pane")).not.toContain("frob_pane");
    expect(screenStepTitle({ title: "frob_pane", status: "ok" })).toBe("Used the screen");
    expect(computerStepDetail({ title: "desktop_show", status: "ok" }, "Showed the desktop")).toBeUndefined();
    expect(computerStepDetail({ title: "focus", status: "ok" }, "Focused a pane")).toBeUndefined();
    expect(plainStepTitle({ tool: "computer", title: "list_windows", status: "ok" })).toBe("Listed open windows");
    expect(plainStepTitle({ tool: "computer", title: "frob_widget", status: "ok" })).toBe("Used the computer");
  });
});
