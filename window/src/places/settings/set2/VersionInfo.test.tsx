// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { VersionInfo, versionInfoText } from "./VersionInfo";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it("copies version, track, engine and desktop builds, and OS in one action", async () => {
  const details = { version: "0.4.4-build-aabbcc", track: "stable", engineBuild: "engine-123", desktopBuild: "desktop-456", os: "Windows 11" };
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<VersionInfo details={details} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")?.click());
  expect(writeText).toHaveBeenCalledWith(versionInfoText(details));
  expect(host.textContent).toContain("Copied.");
  await act(async () => root.unmount());
  host.remove();
});
