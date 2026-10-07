// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesPage } from "./updates";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function show(status: unknown) {
  const engine: WindowEngine = {
    request: (async (method: string) => method === "update.status" ? status : {}) as WindowEngine["request"],
    onEvent: () => () => undefined, sessionKey: "test", scopes: [],
  };
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates & about" level="regular" engine={engine} />));
}

it.each([{}, { updateAvailable: {} }])("keeps incomplete native update status unknown", async (status) => {
  await show(status);
  expect(host.textContent).toContain("Update availability not reported");
  expect(host.textContent).not.toContain("Branch is up to date.");
});
it("preserves the native explicit no-update result", async () => {
  await show({ updateAvailable: null });
  expect(host.textContent).toContain("Branch is up to date.");
});
it("shows an actual waiting version", async () => {
  await show({ updateAvailable: { latestVersion: "1.2.3" } });
  expect(host.textContent).toContain("A Branch update is ready");
});
