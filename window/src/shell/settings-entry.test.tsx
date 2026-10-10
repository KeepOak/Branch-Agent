// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PersonMenu } from "./PersonMenu";
import { Sidebar, type SidebarProps } from "./Sidebar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

it.each([false, true])("keeps one working sidebar Settings gear with the profile menu open (rail=%s)", async (rail) => {
  const settings = vi.fn();
  const noop = () => {};
  const sidebar: SidebarProps = {
    sections: [], openKey: null, currentPlace: "overview", now: 1,
    showPreview: false, rowState: () => ({ waiting: false, working: false }),
    trunkName: () => "Fern", personName: "Owner", hasUnread: false,
    filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null,
    rail, onRailSearch: noop, onOpen: noop, onNew: noop, onMenu: noop,
    onPin: noop, onArchive: noop, onMarkAllRead: noop, onPerson: noop, onSettings: settings,
  };
  const legacyProps = { onSettings: settings };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<>
    <Sidebar {...sidebar} />
    <PersonMenu {...legacyProps} at={{ x: 0, y: 0 }} person="Owner" theme="light" onTheme={noop}
      onShortcuts={noop} onApps={noop} onAbout={noop} onClose={noop} onGuide={noop}
      onReplay={noop} onAddPerson={noop} onLock={noop} />
  </>));
  const entries = [...document.querySelectorAll<HTMLButtonElement>("button")].filter((button) =>
    button.getAttribute("aria-label") === "Settings" || button.textContent?.startsWith("Settings"));
  expect(entries).toHaveLength(1);
  expect(entries[0]?.dataset.testid).toBe("gear");
  await act(async () => entries[0]?.click());
  expect(settings).toHaveBeenCalledTimes(1);
});
