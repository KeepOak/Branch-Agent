// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { OpenTabs, useOpenTabs } from "./OpenTabs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const NAMES: Record<string, string> = { a: "Sapling", b: "Scout", c: "Ledger" };
let openFrom: (key: string) => void = () => {};

function Host() {
  const [open, setOpen] = useState<string | null>("a");
  openFrom = setOpen;
  const tabs = useOpenTabs(open);
  return <OpenTabs keys={tabs.keys} openKey={open} name={(k) => NAMES[k]!} onOpen={setOpen} onClose={(k) => { const next = tabs.close(k); if (next) setOpen(next); }} />;
}

it("shows the open conversations newest first once two are open, and closing the open one moves to the next", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Host />));
  expect(host.querySelector('[data-testid="open-tabs"]')).toBeNull();
  await act(async () => openFrom("b"));
  await act(async () => openFrom("c"));
  const labels = () => [...host.querySelectorAll(".open-tab > button:first-child")].map((b) => b.textContent);
  expect(labels()).toEqual(["Ledger", "Scout", "Sapling"]);
  expect(host.querySelector('[aria-current="page"]')!.textContent).toBe("Ledger");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Ledger"]')!.click());
  expect(host.querySelector('[aria-current="page"]')!.textContent).toBe("Scout");
  expect(labels()).toEqual(["Scout", "Sapling"]);
});
