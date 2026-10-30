// @vitest-environment jsdom
// Atlas VOICE-0123: sound in a conversation shows as a playable badge (thread/Attachments.tsx Player).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Attachments } from "./Attachments";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("play")); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event("pause")); });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("playable audio badge", () => {
  it("draws a voice note as a badge with Play, its name and its time", async () => {
    await act(async () => root.render(<Attachments items={[{ kind: "audio", name: "Voice note.webm", mimeType: "audio/webm", src: "data:audio/webm;base64,GkXfow==", kept: true }]} />));
    const badge = host.querySelector('[data-testid="media-player"]')!;
    expect(badge.classList.contains("audio")).toBe(true);
    expect(badge.querySelector("audio")?.getAttribute("src")).toBe("data:audio/webm;base64,GkXfow==");
    expect(badge.textContent).toContain("Voice note.webm");
    expect(badge.querySelector(".player-time")?.textContent).toBe("0:00 / 0:00");
    const play = badge.querySelector<HTMLButtonElement>("button.play")!;
    expect(play.getAttribute("aria-label")).toBe("Play");
    await act(async () => play.click());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(play.getAttribute("aria-label")).toBe("Pause");
  });

  it("shows a sound the history didn't keep as a file chip, not a dead player", async () => {
    await act(async () => root.render(<Attachments items={[{ kind: "audio", name: "Old note.ogg", kept: false }]} />));
    expect(host.querySelector('[data-testid="media-player"]')).toBeNull();
    expect(host.textContent).toContain("Not kept in the history");
  });
});
