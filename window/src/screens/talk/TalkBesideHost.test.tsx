// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Frame } from "../frame/Frame";
import { DEFAULT_TOOLS } from "../frame/Header";
import { TALK_NEED, useTalkBeside } from "./TalkBesideHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function setup() {
  const request = vi.fn(async (method: string) => method === "chat.history" ? { messages: [{ role: "assistant", content: [{ type: "text", text: "Hi, I can help with this page." }] }] } : method === "chat.send" ? { runId: "r1" } : {});
  const onFull = vi.fn();
  return { request, onFull };
}
function Harness({ shown, request, onFull }: { shown: boolean } & ReturnType<typeof setup>) {
  const talk = useTalkBeside({ shown, request: request as never, onEvent: () => () => undefined, mainKey: "agent:main:main", name: "Sapling", page: "Library", onFull });
  return <Frame sidebar={<nav />} main={<p>Library page</p>} beside={talk.beside} header={{ title: "Library", right: talk.item ? [talk.item, ...DEFAULT_TOOLS] : undefined }} />;
}
async function render(node: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(node));
  await act(async () => undefined);
  return host;
}
const button = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const pane = () => document.querySelector<HTMLElement>("[data-testid=talk-beside]");

describe("Talk beside in R1 (Classic TalkBeside re-hosted, parity row 20)", () => {
  it("adds Talk to Sapling to a place's header, before the usual tools, declaring chat.history and chat.send", async () => {
    const t = setup();
    await render(<Harness shown {...t} />);
    const labels = [...document.querySelectorAll(".r1-header-right button")].map(b => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Talk to Sapling", "Computer · Coming", "Browser · Coming", "More · Coming"]);
    expect(button("Talk to Sapling")!.dataset.need).toBe(TALK_NEED.join(" "));
    expect(pane()).toBeNull();
  });

  it("opens the Classic pane in the Frame's beside slot as clear glass, sends with the page as work context, and closes", async () => {
    const t = setup();
    await render(<Harness shown {...t} />);
    await act(async () => button("Talk to Sapling")!.click());
    await act(async () => undefined);
    const section = document.querySelector<HTMLElement>(".r1-conversation")!;
    expect(section.dataset.beside).toBe("right");
    expect(section.style.getPropertyValue("--r1-beside")).toBe("380px");
    expect(pane()!.parentElement?.closest(".r1-beside")).not.toBeNull();
    expect(pane()!.className).toContain("g-clear");
    expect(pane()!.querySelector(".talk-head b")!.className).toBe("g-label");
    expect(t.request).toHaveBeenCalledWith("chat.history", { sessionKey: "agent:main:main", limit: 60 });
    expect(pane()!.textContent).toContain("Hi, I can help with this page.");
    expect(pane()!.textContent).toContain("Working on: Library");
    const box = pane()!.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "What is in here?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...pane()!.querySelectorAll("button")].find(b => b.textContent === "Send")!.click());
    expect(t.request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "agent:main:main", message: "What is in here?", workContext: expect.anything() }));
    await act(async () => button("Dock at the bottom")!.click());
    expect(section.dataset.beside).toBe("bottom");
    expect(section.style.getPropertyValue("--r1-beside")).toBe("320px");
    await act(async () => button("Open it full size")!.click());
    expect(t.onFull).toHaveBeenCalledWith("agent:main:main");
    expect(pane()).toBeNull();
    expect(section.dataset.beside).toBeUndefined();
  });

  it("Ctrl Shift H opens and closes it on a place, and nothing shows off places", async () => {
    const t = setup();
    await render(<Harness shown {...t} />);
    const press = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "H", code: "KeyH", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })); });
    await press();
    expect(pane()).not.toBeNull();
    await press();
    expect(pane()).toBeNull();
    await act(async () => root!.unmount()); root = undefined;
    await render(<Harness shown={false} {...t} />);
    await press();
    expect(pane()).toBeNull();
    expect(button("Talk to Sapling")).toBeNull();
  });

  it("the page steps aside for the pane: the CSS pins the beside slot and the page's margin", () => {
    const css = readFileSync("src/screens/talk/talk.css", "utf8");
    expect(css).toContain(".r1-conversation[data-beside=\"right\"] > .r1-scroll { margin-right: var(--r1-beside); }");
    expect(css).toContain(".r1-beside { position: absolute; z-index: 5; top: var(--hdr); right: 0; bottom: 0; width: var(--r1-beside);");
  });
});
