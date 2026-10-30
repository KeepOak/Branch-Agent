import { describe, expect, it } from "vitest";
import { computerStatusProblem } from "./computer-status-problem";

const CANT_SEE = "Branch can't see this computer's screen right now. Quit Branch Agent and open it again.";

describe("computerStatusProblem", () => {
  it("shows no problem while the screen is available", () => {
    expect(computerStatusProblem({ available: true, configured: true })).toBeUndefined();
  });
  it("shows the desktop's own sentence as the one line, with no retry", () => {
    expect(computerStatusProblem({ available: false, reason: "Waiting for the driver." }))
      .toEqual({ line: "Waiting for the driver.", retry: false });
  });
  it("uses the plain line when the desktop's reason is empty", () => {
    expect(computerStatusProblem({ available: false, reason: "" })).toEqual({ line: CANT_SEE, retry: false });
  });
  it("says plainly that Branch can't see the screen when the driver is not running, and keeps the code at the technical level", () => {
    expect(computerStatusProblem({
      available: false, configured: true,
      error: "COMPUTER_DRIVER_UNAVAILABLE: the Gateway desktop provider is unavailable",
    })).toEqual({
      line: CANT_SEE,
      retry: false,
      technical: "COMPUTER_DRIVER_UNAVAILABLE: the Gateway desktop provider is unavailable",
    });
  });
  it("says computer control is off when it is not configured", () => {
    expect(computerStatusProblem({ available: false, configured: false })).toEqual({
      line: "Computer control is off. Turn it on in Settings to see this Mac's screen.",
      retry: false,
    });
  });
  it("keeps Try again for an unknown failure, with the plain line", () => {
    expect(computerStatusProblem({ available: false, configured: true, error: "COMPUTER_DRIVER_ERROR: boom" }))
      .toEqual({ line: "Couldn't show this computer's screen.", retry: true, technical: "COMPUTER_DRIVER_ERROR: boom" });
  });
  it("Private #1103: the desktop's permission reason becomes the Screen Recording ask with Open System Settings, not a dead Try again", () => {
    expect(computerStatusProblem({ available: false, configured: true, reason: "macOS asks you to allow this once, in System Settings.", error: "COMPUTER_DRIVER_UNAVAILABLE: x" })).toEqual({
      line: "Branch needs permission to see this screen. Turn on Screen Recording for Branch Agent in System Settings.",
      retry: false,
      permission: true,
      technical: "COMPUTER_DRIVER_UNAVAILABLE: x",
    });
  });
  it("Private #1103: a capture error that names Screen Recording asks for it too, keeping the raw error for Technical", () => {
    const technical = "COMPUTER_DRIVER_ERROR: Screen Recording permission is not granted";
    expect(computerStatusProblem({ available: false, configured: true, error: technical }))
      .toEqual({ line: "Branch needs permission to see this screen. Turn on Screen Recording for Branch Agent in System Settings.", retry: false, permission: true, technical });
  });
  it("never shows the screen-access sentence or jargon for a driver fault", () => {
    const problem = computerStatusProblem({ available: false, configured: true, error: "COMPUTER_DRIVER_UNAVAILABLE: x" });
    expect(problem?.line).not.toContain("screen access");
    expect(problem?.line).not.toMatch(/driver address|COMPUTER_/);
  });
});
