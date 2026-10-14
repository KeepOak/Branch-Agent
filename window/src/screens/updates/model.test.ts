import { describe, expect, it } from "vitest";
import type { ComponentUpdateStatus } from "../../connect/desktop-component-updates";
import { desktopUpdateView, engineUpdateView, updateCopy } from "./model";

const status = (phase: ComponentUpdateStatus["phase"], extra: Partial<ComponentUpdateStatus> = {}): ComponentUpdateStatus =>
  ({ phase, currentVersion: "0.4.4-build-aaaaaaaa", latestVersion: "0.5.0-build-bbbbbbbb", pendingVersion: null, checkedAt: 1, error: null, ...extra });
const desk = (over: Partial<Parameters<typeof desktopUpdateView>[0]> = {}) =>
  desktopUpdateView({ status: status("available"), current: "0.4.4-build-aaaaaaaa", bar: null, staging: false, restartRequested: false, canRestart: true, error: null, ...over });

describe("desktop update view", () => {
  it("is not rendered without a newer release", () => {
    expect(desk({ status: null }).kind).toBe("none");
    expect(desk({ status: status("current", { latestVersion: "0.4.4-build-aaaaaaaa" }) }).kind).toBe("none");
    expect(desk({ status: status("available", { latestVersion: "0.4.3" }) }).kind).toBe("none");
  });
  it("walks offer → installing → restart → restarting → done", () => {
    expect(desk()).toEqual({ kind: "offer", version: "0.5.0-build-bbbbbbbb" });
    expect(desk({ staging: true }).kind).toBe("installing");
    expect(desk({ status: status("staging") }).kind).toBe("installing");
    const staged = status("staged", { pendingVersion: "0.5.0-build-bbbbbbbb" });
    expect(desk({ status: staged })).toMatchObject({ kind: "restart", canRestart: true, note: null });
    expect(desk({ status: staged, restartRequested: true }).kind).toBe("restarting");
    expect(desk({ status: staged, bar: { state: "updating" } }).kind).toBe("restarting");
    expect(desk({ status: status("current", { currentVersion: "0.5.0-build-bbbbbbbb" }), restartRequested: true, bar: { state: "updated" } })).toEqual({ kind: "done", version: "0.5.0-build-bbbbbbbb" });
  });
  it("says why when the engine kept the old version or the update failed", () => {
    const staged = status("staged", { pendingVersion: "0.5.0-build-bbbbbbbb" });
    expect(desk({ status: staged, bar: { state: "kept" } })).toMatchObject({ kind: "restart", note: expect.stringContaining("kept the current version") });
    expect(desk({ status: staged, bar: { state: "failed", message: "disk full" } })).toMatchObject({ kind: "failed", message: "disk full" });
    expect(desk({ error: "Signature mismatch" })).toMatchObject({ kind: "failed", message: "Signature mismatch" });
  });
});

describe("engine update view (outside the desktop app)", () => {
  const avail = { updateAvailable: { latestVersion: "0.5.0" } };
  it("offers, runs with the engine's own step names, fails with its reason and finishes", () => {
    expect(engineUpdateView({ status: {}, current: "0.4.4", started: false, error: null, doneVersion: null }).kind).toBe("none");
    expect(engineUpdateView({ status: avail, current: "0.4.4", started: false, error: null, doneVersion: null })).toEqual({ kind: "offer", version: "0.5.0" });
    expect(engineUpdateView({ status: { ...avail, activeRun: { runId: "r", phase: "staging" } }, current: "0.4.4", started: false, error: null, doneVersion: null }))
      .toEqual({ kind: "installing", version: "0.5.0", step: "Downloading" });
    expect(engineUpdateView({ status: { ...avail, lastRun: { status: "rolled-back", reason: "health check failed" } }, current: "0.4.4", started: false, error: null, doneVersion: null }))
      .toMatchObject({ kind: "failed", message: "health check failed" });
    expect(engineUpdateView({ status: {}, current: "0.5.0", started: false, error: null, doneVersion: "0.5.0" })).toEqual({ kind: "done", version: "0.5.0" });
  });
});

describe("copy matches what the updater does (HANDOFF §5 item 14)", () => {
  it("never says Relaunch, Nothing restarted or a made-up percentage", () => {
    const views = [desk(), desk({ staging: true }), desk({ status: status("staged", { pendingVersion: "0.5.0-build-bbbbbbbb" }) }), desk({ restartRequested: true, status: status("staged", { pendingVersion: "0.5.0-build-bbbbbbbb" }) }),
      { kind: "done", version: "0.5.0-build-bbbbbbbb" } as const];
    const words = views.flatMap(view => Object.values(updateCopy(view))).join(" | ");
    expect(words).not.toMatch(/Relaunch|Nothing restarted|%/);
    expect(updateCopy(views[0])).toMatchObject({ tip: "Update to 0.5.0", banner: "Update to 0.5.0", action: "Install" });
    expect(updateCopy(views[1]).tip).toMatch(/^Installing 0\.5\.0…/);
    expect(updateCopy(views[2])).toMatchObject({ label: "Restart Branch", action: "Restart Branch" });
    expect(updateCopy(views[4])).toMatchObject({ label: "Updated to 0.5.0", action: null });
  });
});
