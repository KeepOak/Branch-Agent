// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const ITEMS = [{ id: "as-set", label: "As set" }, { id: "off", label: "Off" }, { id: "on", label: "On" }];

describe("composer Segmented choices", () => {
  it("marks the saved choice as checked, and picking another choice reports its id", async () => {
    const onPick = vi.fn();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<Segmented label="Thinking text" items={ITEMS} value="off" onPick={onPick} />));
    const radio = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
    expect(radio("Off").getAttribute("aria-checked")).toBe("true");
    expect(radio("As set").getAttribute("aria-checked")).toBe("false");
    await act(async () => radio("As set").click());
    expect(onPick).toHaveBeenCalledWith("as-set");
  });

  it("the As set choice is checked when it is the saved value", async () => {
    const onPick = vi.fn();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<Segmented label="Thinking text" items={ITEMS} value="as-set" onPick={onPick} />));
    const asSet = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "As set")!;
    expect(asSet.getAttribute("aria-checked")).toBe("true");
  });
});
