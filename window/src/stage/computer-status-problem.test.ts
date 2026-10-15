import { describe, expect, it } from "vitest";
import { computerStatusProblem } from "./computer-status-problem";

describe("computerStatusProblem", () => {
  it("shows no problem while the screen is available", () => {
    expect(computerStatusProblem({ available: true, configured: true })).toBeUndefined();
  });
  it("keeps Coming with the app's reason when the desktop names one", () => {
    expect(computerStatusProblem({ available: false, reason: "Waiting for the driver." }))
      .toEqual({ kind: "coming", reason: "Waiting for the driver." });
  });
  it("names a stopped driver plainly and offers no Try again", () => {
    const problem = computerStatusProblem({
      available: false, configured: true,
      error: "COMPUTER_DRIVER_UNAVAILABLE: the Gateway desktop provider is unavailable",
    });
    expect(problem).toEqual({
      kind: "error",
      message: "This Mac's computer driver isn't running. Quit Branch Agent and open it again.",
      retry: false,
    });
  });
  it("says computer control is off when it is not configured", () => {
    const problem = computerStatusProblem({ available: false, configured: false });
    expect(problem).toMatchObject({ kind: "error", retry: false });
    expect(problem && problem.kind === "error" ? problem.message : "").toContain("Computer control is off");
  });
  it("keeps Try again for an unknown failure", () => {
    expect(computerStatusProblem({ available: false, configured: true, error: "COMPUTER_DRIVER_ERROR: boom" }))
      .toEqual({ kind: "error", message: "Couldn't show this computer's screen. Try again.", retry: true });
  });
  it("never shows the screen-access sentence for a driver fault", () => {
    const problem = computerStatusProblem({ available: false, configured: true, error: "COMPUTER_DRIVER_UNAVAILABLE: x" });
    expect(problem && problem.kind === "error" ? problem.message : "").not.toContain("screen access");
  });
});
