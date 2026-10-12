// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:__tests__/components/features/conversation/transcript-export-modal.test.tsx (atlas SESSIONS-0047). Ported download/cancel/retry cases to Branch.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ExportDialog, exportFilename } from "./ExportDialog";

let root: Root;
let host: HTMLDivElement;
const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
const createUrl = vi.fn((_blob: Blob) => "blob:test");
const revokeUrl = vi.fn();
const bridge = (request: ReturnType<typeof vi.fn>): WindowEngine => ({ request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: ["operator.read"], sessionKey: "other" });
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
  vi.clearAllMocks();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });
async function mount(request: ReturnType<typeof vi.fn>, onClose = vi.fn()) {
  await act(async () => root.render(<ExportDialog engine={bridge(request)} sessionKey="chosen" title="Test conversation" onClose={onClose} />));
  return onClose;
}
async function press(text: string) { await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click()); }
async function blobText(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe("conversation export dialog", () => {
  it("uses upstream defaults and downloads bytes for the chosen conversation", async () => {
    const request = vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "persisted words" }], hasMore: false });
    const close = await mount(request);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => input.checked)).toBe(true);
    expect(host.querySelector<HTMLSelectElement>("select")!.value).toBe("markdown");
    await press("Save file");
    expect(request).toHaveBeenCalledWith("chat.history", { sessionKey: "chosen", offset: 0, limit: 100 });
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:test");
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("cancels a pending read without downloading or reporting success", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const close = await mount(request);
    await press("Save file");
    expect(host.textContent).toContain("Reading conversation");
    await press("Not now");
    await act(async () => resolve({ messages: [], hasMore: false }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });
  it("downloads a self-contained replay from every persisted history page", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ messages: [{ role: "assistant", content: "last page" }], hasMore: true, nextOffset: 1 })
      .mockResolvedValueOnce({ messages: [{ role: "user", content: "first page" }], hasMore: false });
    const close = await mount(request);
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { select.value = "replay"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await press("Save file");
    expect(request).toHaveBeenCalledTimes(2);
    const html = await blobText(createUrl.mock.calls[0][0]);
    expect(html).toContain('id="branch-replay-data"');
    expect(html).toContain('id="branch-replay-play"');
    expect(html).toContain("first page"); expect(html).toContain("last page");
    const document = new DOMParser().parseFromString(html, "text/html");
    const recording = JSON.parse(document.getElementById("branch-replay-data")!.textContent!);
    expect(recording.session.id).toBe("chosen");
    expect(recording.events.map((event: { content: string }) => event.content)).toEqual(["first page", "last page"]);
    expect(exportFilename("Fixture", "replay")).toBe("Fixture.replay.html");
    expect(click).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps the dialog open on failure and permits a real retry", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("Engine offline")).mockResolvedValueOnce({ messages: [], hasMore: false });
    const close = await mount(request);
    await press("Save file");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Engine offline");
    expect(close).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
    await press("Save file");
    expect(click).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  });
  it("uses safe Windows filenames without clipping the user's title", () => {
    expect(exportFilename("CON", "markdown")).toBe("_CON.md");
    expect(exportFilename("a/b: c. ", "html")).toBe("a_b_ c.html");
    expect(exportFilename(" ", "markdown")).toBe("Conversation.md");
  });
});
