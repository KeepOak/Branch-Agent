// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, dotBox, InitialsFace, initials, leafSize, LEAF_TIP, statusSize, toneFor } from "./Avatar";
import { clusterLayout, GroupCluster } from "./GroupCluster";
import { Menu, type MenuEntry } from "./Menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
const render = async (node: React.ReactNode) => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
};
const key = async (target: Element, k: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

describe("Avatar", () => {
  it("sizes the waiting dot from the size prop, matching the approved preview", () => {
    expect([16, 24, 32, 40, 56, 80].map(size => dotBox(size).d)).toEqual([6, 6.72, 8.96, 11.2, 12, 12]);
    expect(dotBox(40)).toEqual({ d: 11.2, offset: 0.24, ring: 2 });
    expect(dotBox(24).ring).toBe(1.5);
  });
  it("sizes the leaf and presence dot with their clamps", () => {
    expect([24, 40, 56, 80].map(leafSize)).toEqual([11, 13.6, 19.04, 20]);
    expect([16, 40].map(statusSize)).toEqual([7, 11.2]);
  });
  it("draws the leaf with its tooltip and the waiting dot on the 45° point", async () => {
    const host = await render(<Avatar size={40} face={<span>face</span>} status="waiting" leaf ring="side" label="Sapling" />);
    const wait = host.querySelector<HTMLElement>(".g-av-wait")!;
    expect(wait.style.width).toBe("11.2px");
    expect(wait.style.right).toBe("0.24px");
    expect(wait.style.boxShadow).toContain("var(--side");
    expect(host.querySelector(".g-av-leaf")?.getAttribute("title")).toBe(LEAF_TIP);
    expect(host.querySelector(".g-av")?.getAttribute("aria-label")).toBe("Sapling");
  });
  it("gives a person stable initials and tint", async () => {
    expect(initials("Dana Okafor")).toBe("DO");
    expect(initials("taofik")).toBe("TA");
    expect(toneFor("Dana Okafor")).toBe(toneFor("Dana Okafor"));
    const host = await render(<InitialsFace name="Claude Code" kind="grafted" />);
    expect(host.textContent).toBe("CC");
    expect(host.querySelector("[data-kind=grafted]")).not.toBeNull();
  });
});

describe("GroupCluster", () => {
  it("places two on a diagonal, three in TL TR BL, and folds the rest into +N", () => {
    expect(clusterLayout(2)).toEqual({ slots: ["tl", "br"], more: 0 });
    expect(clusterLayout(3)).toEqual({ slots: ["tl", "tr", "bl"], more: 0 });
    expect(clusterLayout(6)).toEqual({ slots: ["tl", "tr", "bl"], more: 3 });
  });
  it("renders faces in their slots and the +N disc", async () => {
    const host = await render(<GroupCluster size={40} members={["a", "b", "c", "d", "e"].map(name => <i key={name}>{name}</i>)} label="Month-end team" />);
    expect([...host.querySelectorAll<HTMLElement>(".g-cluster-face")].map(face => face.dataset.slot)).toEqual(["tl", "tr", "bl", "br"]);
    expect(host.querySelector(".g-cluster-more")?.textContent).toBe("+2");
  });
  it("draws the +N disc from the box size, not a measured font", async () => {
    const host = await render(<GroupCluster size={40} members={["a", "b", "c", "d"].map(name => <i key={name}>{name}</i>)} />);
    expect(host.querySelector<HTMLElement>(".g-cluster-more")?.style.fontSize).toBe("");
    expect(host.querySelector(".g-cluster-more")?.getAttribute("data-slot")).toBe("br");
  });
  it("lets a group photo replace the cluster", async () => {
    const host = await render(<GroupCluster size={40} members={[<i key="a" />]} photo="/p.png" />);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/p.png");
    expect(host.querySelector(".g-cluster-face")).toBeNull();
  });
});

describe("Menu", () => {
  const build = (spy: (what: string) => void): { tiles: MenuEntry[]; rows: MenuEntry[] } => ({
    tiles: [
      { label: "Pin", letter: "p", onSelect: () => spy("pin") },
      { label: "Unread", letter: "u", onSelect: () => spy("unread") },
      { label: "Snooze", submenu: [{ label: "In 1 hour", onSelect: () => spy("1h") }] },
      { label: "Archive", letter: "a", off: "Your default stays in the list" },
    ],
    rows: [
      { label: "Rename", letter: "r", onSelect: () => spy("rename") },
      { label: "Delete conversation…", letter: "d", danger: true, gap: true, onSelect: () => spy("delete") },
    ],
  });
  it("opens with tiles and rows, runs a row and closes", async () => {
    const spy = vi.fn(), onClose = vi.fn();
    const host = await render(<Menu label="Conversation" {...build(spy)} onClose={onClose} />);
    expect([...host.querySelectorAll(".g-menu-tile")].map(tile => tile.getAttribute("aria-label") ?? tile.textContent)).toEqual(["Pin", "Unread", "Snooze ›", "ArchiveYour default stays in the list"]);
    expect(host.querySelector("[data-danger]")?.hasAttribute("data-gap")).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>(".g-menu-row")!.click());
    expect(spy).toHaveBeenCalledWith("rename");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows an unavailable tile's reason and runs nothing", async () => {
    const spy = vi.fn(), onClose = vi.fn();
    const host = await render(<Menu label="Conversation" {...build(spy)} onClose={onClose} />);
    const archive = [...host.querySelectorAll<HTMLButtonElement>(".g-menu-tile")][3];
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    await act(async () => archive.click());
    expect(spy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("runs a row by its letter and moves with the arrow keys", async () => {
    const spy = vi.fn();
    const host = await render(<Menu label="Conversation" {...build(spy)} onClose={() => undefined} />);
    const menu = host.querySelector(".g-menu")!;
    expect(document.activeElement?.textContent).toBe("Pin");
    await key(menu, "ArrowDown");
    expect(document.activeElement?.textContent).toBe("Unread");
    await key(menu, "d");
    expect(spy).toHaveBeenCalledWith("delete");
  });
  it("flips a toggle row in place and keeps the menu open", async () => {
    const flip = vi.fn(), onClose = vi.fn();
    const host = await render(<Menu label="Conversation" rows={[{ label: "Mute", toggle: true, onSelect: flip }]} onClose={onClose} />);
    const row = host.querySelector<HTMLButtonElement>(".g-menu-row")!;
    expect(row.getAttribute("role")).toBe("menuitemcheckbox");
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector(".g-menu-switch[data-on]")).not.toBeNull();
    await act(async () => row.click());
    expect(flip).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
  it("opens a submenu in place with a back row", async () => {
    const spy = vi.fn();
    const host = await render(<Menu label="Conversation" {...build(spy)} onClose={() => undefined} />);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".g-menu-tile")][2].click());
    expect(host.querySelector(".g-menu-back")?.textContent).toBe("Snooze");
    expect(host.querySelector(".g-menu-tiles")).toBeNull();
    await key(host.querySelector(".g-menu")!, "ArrowLeft");
    expect(host.querySelectorAll(".g-menu-tile")).toHaveLength(4);
  });
});
