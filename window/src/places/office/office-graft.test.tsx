// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OfficePlace } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("./pixel/webview-ui/src/branch/mount", () => ({
  Storage: class { constructor(_initial: unknown, _save: unknown) {} },
  mountPixelOffice: () => ({ update: () => undefined, setReducedMotion: () => undefined, destroy: () => undefined }),
}));

afterEach(() => { document.body.replaceChildren(); });

it("Graft an agent in the Grove header opens Customize on its Agents kind", async () => {
  const engine = { request: vi.fn(async () => ({})), onEvent: () => () => undefined } as unknown as WindowEngine;
  const openPlace = vi.fn();
  const seen: unknown[] = [];
  const listen = (event: Event) => seen.push((event as CustomEvent).detail);
  addEventListener("branch:place-tab", listen);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<OfficePlace engine={engine} facts={{ running: 0, waiting: 0 }} level="regular" openConversation={() => undefined} openPlace={openPlace} />); });
  const graft = [...host.querySelectorAll("button")].find(b => b.textContent === "Graft an agent");
  expect(graft).toBeTruthy();
  await act(async () => graft!.click());
  expect(openPlace).toHaveBeenCalledWith("customize");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(seen).toContainEqual({ place: "customize", tab: "Agents" });
  removeEventListener("branch:place-tab", listen);
  await act(async () => root.unmount());
});
