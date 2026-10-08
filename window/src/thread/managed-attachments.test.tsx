// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { Attachments } from "./Attachments";
import { ThreadContext } from "./context";
import { readAttachment } from "./history";
import type { Attachment } from "./model";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const KEY = "agent:juniper:main";
const ID = "artifact_managed_image_4421584c-47ae-456b-80ce-2df00845e107";
const PATH = `/api/chat/media/outgoing/${encodeURIComponent(KEY)}/${ID.slice("artifact_managed_image_".length)}/full`;
const image = () => readAttachment({ type: "image", artifactId: ID, url: PATH, alt: "cat.png", mimeType: "image/png" })!;
const ticket = (name = "short-ticket") => ({ url: `${PATH}?mediaTicket=${name}` });
const makeEngine = (request: (...args: unknown[]) => Promise<unknown> = vi.fn(async () => ticket()), sessionKey = KEY): WindowEngine => ({
  gatewayUrl: "ws://127.0.0.1:19700", sessionKey, agentId: "juniper", scopes: [],
  onEvent: () => () => {}, request: request as WindowEngine["request"],
});
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
async function render(engine: WindowEngine, items: Attachment[] = [image()]) {
  if (!root) { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); }
  await act(async () => root!.render(<ThreadContext.Provider value={{ engine, name: "Juniper", toast: () => {}, running: false }}><Attachments items={items} /></ThreadContext.Provider>));
  return host;
}
async function event(name: "error" | "load") {
  await act(async () => host.querySelector(".picture img")!.dispatchEvent(new Event(name)));
}

describe("managed attachments", () => {
  it("authorizes a persisted generated image and uses the gateway origin rather than the window origin", async () => {
    const request = vi.fn(async () => ticket());
    await render(makeEngine(request));
    expect(request).toHaveBeenCalledWith("artifacts.download", { sessionKey: KEY, agentId: "juniper", artifactId: ID });
    const img = host.querySelector(".picture img")!;
    expect(img.getAttribute("src")).toBe(`http://127.0.0.1:19700${PATH}?mediaTicket=short-ticket`);
    expect(img.getAttribute("alt")).toBe("cat.png");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("src")).not.toMatch(/[?&]token=/);
    await act(async () => (host.querySelector(".picture") as HTMLButtonElement).click());
    expect(host.querySelector(".picture-viewer img")?.getAttribute("src") ?? host.querySelector('[role="dialog"] img')?.getAttribute("src")).toBe(img.getAttribute("src"));
  });

  it("does not mount an unticketed URL while authorization is pending", async () => {
    let finish!: (value: ReturnType<typeof ticket>) => void;
    const request = vi.fn(() => new Promise<ReturnType<typeof ticket>>((resolve) => { finish = resolve; }));
    await render(makeEngine(request));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Loading cat.png");
    await act(async () => finish(ticket()));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("mediaTicket=short-ticket");
  });

  it("refreshes an expired ticket once, then offers retry and recovers", async () => {
    let n = 0;
    const request = vi.fn(async () => ticket(`ticket-${++n}`));
    await render(makeEngine(request));
    await event("error");
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.querySelector("img")?.getAttribute("src")).toContain("ticket-2");
    await event("error");
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Attachment unavailable");
    await act(async () => (host.querySelector('[data-testid="attachment-unavailable"] button') as HTMLButtonElement).click());
    expect(host.querySelector("img")?.getAttribute("src")).toContain("ticket-3");
    await event("load");
    await event("error");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("shows a real unavailable state when artifact authorization is denied", async () => {
    await render(makeEngine(vi.fn(async () => { throw new Error("FORBIDDEN"); })));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("Attachment unavailable");
    expect(host.textContent).toContain("Try again");
  });

  it("ignores an old connection's pending ticket when the conversation changes", async () => {
    let finish!: (value: ReturnType<typeof ticket>) => void;
    await render(makeEngine(vi.fn(() => new Promise<ReturnType<typeof ticket>>((resolve) => { finish = resolve; }))));
    await render(makeEngine(vi.fn(async () => ticket("new-connection")), "agent:juniper:other"));
    await act(async () => finish(ticket("old-connection")));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("new-connection");
    expect(host.innerHTML).not.toContain("old-connection");
  });

  it("keeps inline and external attachments unchanged without artifact RPCs", async () => {
    const request = vi.fn(async () => ticket());
    await render(makeEngine(request), [{ kind: "image", name: "inline.png", src: "data:image/png;base64,AAAA", kept: true }, { kind: "file", name: "report.txt", src: "https://example.test/report.txt", kept: true }]);
    expect(request).not.toHaveBeenCalled();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.test/report.txt");
  });

  it("uses the same authorized flow for managed audio, video and file downloads over wss", async () => {
    const items = (["audio", "video", "file"] as const).map((kind) => ({ kind, name: `${kind}.bin`, artifactId: `artifact_managed_media_${kind}`, src: "/unused", kept: true }));
    const request = vi.fn(async () => ({ url: "/api/chat/media/outgoing/test/full?mediaTicket=media" }));
    const engine = makeEngine(request); engine.gatewayUrl = "wss://gateway.example";
    await render(engine, items);
    expect(request).toHaveBeenCalledTimes(3);
    for (const element of host.querySelectorAll("audio,video,a")) {
      expect(element.getAttribute(element.tagName === "A" ? "href" : "src")).toBe("https://gateway.example/api/chat/media/outgoing/test/full?mediaTicket=media");
    }
  });

  it("supports the existing inline image fallback from artifacts.download", async () => {
    await render(makeEngine(vi.fn(async () => ({ encoding: "base64", data: "AAAA", artifact: { type: "image", mimeType: "image/png" } }))));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});
