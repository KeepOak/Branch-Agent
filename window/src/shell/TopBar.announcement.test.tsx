// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HeaderRow, type HeaderInfo } from "./TopBar";

vi.mock("../face/Pebble", () => ({ Pebble: () => <span aria-hidden="true" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("announces the living header avatar's state politely at narrow widths", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const header: HeaderInfo = { name: "Juniper", trunkName: "Juniper", state: "working", activityState: "search", isDefaultTrunk: false, renaming: false, onRename: () => {} };
  await act(async () => root.render(<HeaderRow header={header} />));
  const status = host.querySelector('[role="status"][aria-live="polite"]');
  expect(status?.textContent).toBe("Juniper: Searching");
  await act(async () => root.render(<HeaderRow header={{ ...header, state: "working", activityState: "read" }} />));
  expect(host.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
  expect(status?.textContent).toBe("Juniper: Reading");
  await act(async () => root.unmount());
  host.remove();
});
