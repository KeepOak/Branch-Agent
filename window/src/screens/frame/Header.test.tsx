// @vitest-environment jsdom
// The title pill opens the agent details. It is a plain control, never gated on a capability the engine may not list.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Header } from "./Header";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("the title pill opens the agent details without waiting on an engine capability", async () => {
  const onOpen = vi.fn();
  // An engine that lists no methods at all: a capability-gated control would draw as Coming here.
  const engine = { features: {} } as unknown as Parameters<typeof Header>[0]["engine"];
  await act(async () => root.render(<Header title="Juniper" onToggleSidebar={() => undefined} onOpen={onOpen} engine={engine} />));
  const pill = host.querySelector<HTMLButtonElement>(".g-pill")!;
  expect(pill.disabled).toBe(false);
  expect(pill.getAttribute("aria-label")).toBe("Juniper");
  await act(async () => pill.click());
  expect(onOpen).toHaveBeenCalledTimes(1);
});
