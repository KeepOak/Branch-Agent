// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider, noteUnknownMethod } from "../connect/capabilities";
import type { EngineFeatures } from "../connect/engine";
import { Coming } from "./coming";
import { COMING_REASON, comingControls, comingReport, undeclaredControls } from "./coming-registry";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const render = async (node: React.ReactNode) => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
};
const features = (methods: string[]): EngineFeatures => ({ methods, events: [] });

describe("Coming", () => {
  it("leaves a wired control alone and marks the call it declares", async () => {
    const onClick = vi.fn();
    const host = await render(<CapabilityProvider engine={{ features: features(["channels.add"]) }}>
      <Coming need="channels.add"><button type="button" onClick={onClick}>Add Slack</button></Coming>
    </CapabilityProvider>);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-disabled")).toBeNull();
    expect(button.dataset.need).toBe("channels.add");
    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(comingControls()).toEqual([]);
  });

  it("draws an unwired control greyed with its reason and runs nothing", async () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const host = await render(<CapabilityProvider engine={{ features: features([]) }}>
      <Coming need="channels.add" reason="Setting up Slack comes in a later update.">
        <button type="button" style={{ height: 32 }} onClick={onClick} onKeyDown={onKeyDown}>Add Slack</button>
      </Coming>
    </CapabilityProvider>);
    const button = host.querySelector("button")!;
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.title).toBe("Setting up Slack comes in a later update.");
    expect(button.style.opacity).toBe("0.55");
    expect(button.style.cursor).toBe("not-allowed");
    expect(button.style.height).toBe("32px");
    await act(async () => button.click());
    await act(async () => void button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(comingControls()).toEqual([{ need: ["channels.add"], missing: ["channels.add"], reason: "Setting up Slack comes in a later update.", where: "Add Slack", hidden: false }]);
  });

  it("stops a checkbox from toggling and uses the default reason", async () => {
    const host = await render(<Coming engine={{ features: features(["config.get"]) }} need={["config.get", "config.patch"]}>
      <input type="checkbox" aria-label="Auto-update" defaultChecked={false} />
    </Coming>);
    const box = host.querySelector("input")!;
    await act(async () => box.click());
    expect(box.checked).toBe(false);
    expect(box.title).toBe(COMING_REASON);
    expect(comingControls()[0]).toMatchObject({ missing: ["config.patch"], where: "Auto-update" });
  });

  it("hides a control the owner wants hidden but still lists it", async () => {
    const host = await render(<Coming engine={{ features: features([]) }} need="window.open" hidden where="Open in new window">
      <button type="button">Open in new window</button>
    </Coming>);
    expect(host.querySelector("button")).toBeNull();
    expect(comingControls()).toEqual([expect.objectContaining({ where: "Open in new window", hidden: true })]);
  });

  it("draws the control as it is before the first hello", async () => {
    const host = await render(<Coming engine={{}} need="channels.add"><button type="button">Add</button></Coming>);
    expect(host.querySelector("button")!.getAttribute("aria-disabled")).toBeNull();
    expect(comingControls()).toEqual([]);
  });

  it("turns to Coming when the engine answers unknown method, and unregisters on unmount", async () => {
    const engine = { features: features(["canopy.cards.list"]) };
    const host = await render(<Coming engine={engine} need="canopy.cards.list"><button type="button">Cards</button></Coming>);
    expect(host.querySelector("button")!.getAttribute("aria-disabled")).toBeNull();
    await act(async () => void noteUnknownMethod(engine, "canopy.cards.list", new Error("unknown method: canopy.cards.list")));
    expect(host.querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
    expect(comingControls()).toHaveLength(1);
    await act(async () => root!.unmount()); root = undefined;
    expect(comingControls()).toEqual([]);
  });
});

describe("the dev check", () => {
  it("lists every control that is neither Coming nor declared, against an engine with no methods", async () => {
    const host = await render(<CapabilityProvider engine={{ features: features([]) }}>
      <Coming need="sessions.delete"><button type="button">Delete</button></Coming>
      <button type="button" data-local>Back</button>
      <div data-local><button type="button">Close</button></div>
      <button type="button" disabled>Send</button>
      <button type="button">Rename</button>
      <a href="#x">Docs</a>
    </CapabilityProvider>);
    expect(undeclaredControls(host).map((element) => element.textContent)).toEqual(["Rename", "Docs"]);
    expect((window as unknown as { __branchComing: typeof comingReport }).__branchComing(host)).toEqual({
      coming: [expect.objectContaining({ need: ["sessions.delete"], where: "Delete" })],
      undeclared: ["Rename", "Docs"],
    });
  });
});
