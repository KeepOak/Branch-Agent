// @vitest-environment jsdom
// Get the apps (Private #1814): a failed download page reads as one plain sentence at Regular, the exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetAppsDialog } from "./GetApps";
import { PLAIN_FAILURE } from "./plain-error";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What the Branch app's bridge rejects with when the download page can't open (Electron prefixes the channel).
const IPC = "Error invoking remote method 'branch-desktop:controls:open-download': Error: No download page for android";
const OFFLINE = "getaddrinfo ENOTFOUND api.github.com";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.removeItem("branch.level");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  localStorage.removeItem("branch.level");
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

async function failWith(message: string): Promise<string> {
  const openDownload = async () => { throw new Error(message); };
  (window as { branchDesktop?: unknown }).branchDesktop = { controls: { openDownload } };
  await act(async () => root.render(<GetAppsDialog onClose={() => undefined} onPair={() => undefined} />));
  const getIt = document.querySelector<HTMLButtonElement>(".appsPA18 .tile button");
  await act(async () => getIt?.click());
  for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); });
  return document.querySelector("[data-testid=get-apps] [role=alert], [role=alert]")?.textContent ?? "";
}

describe("Get the apps never shows a raw download error at Regular", () => {
  it("reads the bridge's refusal as one plain sentence with a next step", async () => {
    const line = await failWith(IPC);
    expect(line).toBe(PLAIN_FAILURE);
    expect(line).not.toMatch(/invoking|remote method|branch-desktop|open-download/);
  });

  it("names a network failure in plain words", async () => {
    const line = await failWith(OFFLINE);
    expect(line).toBe(REACH);
    expect(line).not.toMatch(/ENOTFOUND|getaddrinfo|github/);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await failWith(IPC)).toBe(IPC);
  });
});
