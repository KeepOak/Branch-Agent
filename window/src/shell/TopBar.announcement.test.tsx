// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HeaderRow, type HeaderInfo } from "./TopBar";

vi.mock("../face/Pebble", () => ({ Pebble: () => <span aria-hidden="true" /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each([
  ["think", "Thinking it over"],
  ["work", "Working on it"],
  ["search", "Searching"],
  ["read", "Reading"],
] as const)("announces %s without implying screen control at narrow widths", async (state, words) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const header: HeaderInfo = { name: "Juniper", trunkName: "Juniper", state, isDefaultTrunk: false, renaming: false, onRename: () => {} };
  await act(async () => root.render(<HeaderRow header={header} />));
  const status = host.querySelector('[role="status"][aria-live="polite"]');
  expect(status?.textContent).toBe("Juniper: " + words);
  expect(host.querySelector(".head-state")?.textContent).toBe(words);
  await act(async () => root.render(<HeaderRow header={{ ...header, state: "wait" }} />));
  expect(host.querySelectorAll('[role="status"][aria-live="polite"]')).toHaveLength(1);
  expect(status?.textContent).toBe("Juniper: Waiting for you");
  await act(async () => root.unmount());
  host.remove();
});
