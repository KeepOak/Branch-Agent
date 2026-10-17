// @vitest-environment jsdom
// Get the apps: a failed open reads as one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GetAppsDialog } from "./GetApps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

describe("Get the apps never shows a raw engine error at Regular", () => {
  it("names a failed download open in a plain sentence", async () => {
    const openDownload = vi.fn(async () => { throw new Error(ENGINE); });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { openDownload } };
    await act(async () => root.render(<GetAppsDialog onClose={() => undefined} onPair={() => undefined} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".appsPA18 .tile button")!.click());
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const openDownload = vi.fn(async () => { throw new Error("unknown method: logbook.status"); });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { openDownload } };
    await act(async () => root.render(<GetAppsDialog onClose={() => undefined} onPair={() => undefined} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".appsPA18 .tile button")!.click());
    expect(host.querySelector("[role='alert']")?.textContent).toBe("unknown method: logbook.status");
  });
});
