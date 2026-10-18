// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { allBlack } from "./blank-frame";
import { DESKTOP_NEEDS_PERMISSION, isScreenPermissionError, openScreenRecordingSettings, SCREEN_PERMISSION_LINE, SCREEN_RECORDING_SETTINGS_URL } from "./screen-permission";

// Private #1103 item 5: the Screen Recording ask, its System Settings deep link, and what counts as macOS saying no.
describe("the Screen Recording ask", () => {
  it("uses the owner's plain sentence", () => {
    expect(SCREEN_PERMISSION_LINE).toBe("Branch needs permission to see this screen. Turn on Screen Recording for Branch Agent in System Settings.");
  });
  it("Open System Settings deep-links to Privacy & Security › Screen Recording in a new window", () => {
    const open = vi.fn();
    openScreenRecordingSettings(open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", "_blank");
    expect(SCREEN_RECORDING_SETTINGS_URL).toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
  });
  it("by default goes through window.open, the desktop's open-external path", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      openScreenRecordingSettings();
      expect(open).toHaveBeenCalledWith(SCREEN_RECORDING_SETTINGS_URL, "_blank");
    } finally { open.mockRestore(); }
  });
  it.each([
    DESKTOP_NEEDS_PERMISSION,
    "COMPUTER_DRIVER_ERROR: Screen Recording permission is not granted",
    "COMPUTER_DRIVER_ERROR: ScreenCaptureKit: the user declined TCCs for application, window, display capture",
    "escalation reason permission_required",
  ])("treats %j as macOS holding the screen back", (text) => {
    expect(isScreenPermissionError(text)).toBe(true);
  });
  it.each([undefined, "", "COMPUTER_DRIVER_ERROR: CUA MCP proxy returned an invalid JSON-RPC version", "COMPUTER_DRIVER_UNAVAILABLE: x", "Waiting for the driver."])(
    "does not treat %j as a permission problem", (text) => {
      expect(isScreenPermissionError(text)).toBe(false);
    });
});

describe("an empty capture", () => {
  it("is every sampled pixel black, whatever the alpha", () => {
    expect(allBlack([0, 0, 0, 255, 1, 2, 0, 255, 0, 0, 0, 0])).toBe(true);
  });
  it("is not a frame with any lit pixel, or no pixels at all", () => {
    expect(allBlack([0, 0, 0, 255, 0, 40, 0, 255])).toBe(false);
    expect(allBlack([])).toBe(false);
  });
});
