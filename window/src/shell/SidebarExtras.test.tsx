// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NewsTip, petWords, SidePet } from "./SidebarExtras";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function show(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

it("says who needs a yes first, then who is working, else a tip", () => {
  expect(petWords("Ledger", "Scout")).toBe("Ledger needs a yes. It’s in your Inbox.");
  expect(petWords(null, "Scout")).toBe("Scout is working. I’ll shout when it’s done.");
  expect(petWords(null, null, 0)).toBe("Type @ to call a Trunk into any conversation.");
});

it("shows this version's first new thing, opens it from See, and stays dismissed for that version", async () => {
  const run = vi.fn();
  const row = { icon: "spark" as const, title: "Setup and the walkthrough", line: "Eleven short steps.", run };
  const host = await show(<NewsTip version="0.19.4" row={row} />);
  expect(host.textContent).toContain("New: Setup and the walkthrough");
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "See")!.click());
  expect(run).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="news-tip"]')).toBeNull();
  await act(async () => root!.unmount());
  const again = await show(<NewsTip version="0.19.4" row={row} />);
  expect(again.querySelector('[data-testid="news-tip"]')).toBeNull();
  await act(async () => root!.unmount());
  const next = await show(<NewsTip version="0.20.0" row={row} />);
  expect(next.querySelector('[data-testid="news-tip"]')).not.toBeNull();
});

it("walks in the list only when Appearance puts it there, and a click shows one tip", async () => {
  const host = await show(<SidePet pet={{ id: "px-squirrel", where: "status", name: "Hazel" }} waiting={null} working={null} />);
  expect(host.querySelector('[data-testid="pet-strip"]')).toBeNull();
  await act(async () => root!.render(<SidePet pet={{ id: "px-squirrel", where: "side", name: "Hazel" }} waiting={null} working="Scout" />));
  const pet = host.querySelector<HTMLButtonElement>(".pet-btn")!;
  expect(pet.getAttribute("aria-label")).toBe("Hazel the squirrel. Click for a tip.");
  await act(async () => pet.click());
  expect(host.querySelector(".pet-say")!.textContent).toBe("Scout is working. I’ll shout when it’s done.");
});
