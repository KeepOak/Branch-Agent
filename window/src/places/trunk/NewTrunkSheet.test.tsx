// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewTrunkSheet } from "./NewTrunkSheet";
import { TRUNK_COLOURS } from "./new-trunk-sheet";

vi.mock("../../face/Face", () => ({
  Face: ({ label, pebbleLook }: { label?: string; pebbleLook?: { colour?: string; shape?: string; eyes?: string } }) => (
    <span data-face={label} data-colour={pebbleLook?.colour} data-shape={pebbleLook?.shape} data-eyes={pebbleLook?.eyes} />
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const sheet = () => document.querySelector('[data-testid="new-trunk-sheet"]');
const create = () => [...document.querySelectorAll("button")].find((button) => button.textContent === "Create" || button.textContent === "Creating…") as HTMLButtonElement;
const name = () => document.querySelector('input[aria-label="Name"]') as HTMLInputElement;

async function typeName(value: string) {
  await act(async () => {
    const input = name();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("New Trunk sheet", () => {
  it("keeps Create off until there is a name, and sends the face that is showing", async () => {
    const onCreate = vi.fn();
    const onClose = vi.fn();
    await act(async () => root.render(<NewTrunkSheet count={1} onClose={onClose} onCreate={onCreate} />));
    const dialog = sheet();
    expect(dialog?.getAttribute("aria-label")).toBe("New Trunk");
    expect(dialog?.textContent).not.toMatch(/Model|Instructions|Tools/);
    expect(create().disabled).toBe(true);
    expect(document.querySelector("[data-face]")?.getAttribute("data-colour")).toBe(TRUNK_COLOURS[1]);
    expect(document.querySelector("[data-face]")?.getAttribute("data-shape")).toBe("Circle");
    expect(document.querySelector("[data-face]")?.getAttribute("data-eyes")).toBe("Round");
    const shapes = [...document.querySelectorAll(".nt-shape")];
    expect(shapes.map((button) => button.textContent)).toEqual(["Circle", "Stone", "Leaf", "Acorn", "Shield"]);
    expect(shapes.map((button) => button.getAttribute("aria-label"))).toEqual(["Circle", "Stone", "Leaf", "Acorn", "Shield"]);
    const colours = [...document.querySelectorAll(".nt-colour")];
    expect(colours).toHaveLength(TRUNK_COLOURS.length);
    expect(colours.every((button) => button.textContent === "")).toBe(true);
    await typeName("   ");
    expect(create().disabled).toBe(true);
    await act(async () => { (document.querySelector('button[aria-label="Leaf"]') as HTMLButtonElement).click(); });
    await act(async () => { (document.querySelector('button[aria-label="Colour #B84A6B"]') as HTMLButtonElement).click(); });
    expect(document.querySelector('button[aria-label="Leaf"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('button[aria-label="Leaf"] svg path')?.getAttribute("d")).toBe("M5 35Q-1 4 35 5Q36 36 5 35Z");
    expect(document.querySelector("[data-face]")?.getAttribute("data-shape")).toBe("Leaf");
    expect(document.querySelector("[data-face]")?.getAttribute("data-colour")).toBe("#B84A6B");
    await typeName("  Fern  ");
    expect(create().disabled).toBe(false);
    await act(async () => { create().click(); });
    expect(onCreate).toHaveBeenCalledWith({ name: "Fern", colour: "#B84A6B", shape: "Leaf" });
    await act(async () => { (document.querySelector("button.btn.ghost") as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows Creating and the engine’s reason while the Trunk is being made", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<NewTrunkSheet count={0} busy error="That Trunk name is already taken. Choose another name." onClose={onClose} onCreate={vi.fn()} />));
    expect(create().disabled).toBe(true);
    expect(create().textContent).toBe("Creating…");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("That Trunk name is already taken. Choose another name.");
    await act(async () => { (document.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click(); });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
