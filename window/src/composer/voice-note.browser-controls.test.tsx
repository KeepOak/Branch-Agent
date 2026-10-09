// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useVoiceNote, VoiceNoteStrip } from "./VoiceParts";
import { PlusMenu } from "./PlusMenu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("records and attaches a voice note from the menu with a selected Trunk", async () => {
  const stopTrack = vi.fn();
  const media = { getTracks: () => [{ stop: stopTrack }] };
  const getUserMedia = vi.fn(async () => media);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const recording = vi.fn();
  class Recorder {
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    constructor(stream: unknown) { expect(stream).toBe(media); }
    start() { recording(); }
    stop() {
      this.ondataavailable?.({ data: new Blob(["recorded audio"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const onFile = vi.fn();
  const onProblem = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const anchor = createRef<HTMLElement>();
  anchor.current = document.body.appendChild(document.createElement("button"));
  function Probe() {
    const note = useVoiceNote(onFile, onProblem);
    return note.on ? <VoiceNoteStrip started={note.started} onDone={note.done} /> :
      <PlusMenu anchor={anchor} onClose={() => {}} onAttach={() => {}} onFolder={() => {}} onPhoto={() => {}} onInsert={() => {}}
        trunkId="oak" trunks={[{ id: "oak", name: "Oak", defaultMode: "ask", theme: "", model: "" }]}
        onBackground={() => {}} temporary={false} onWhoAnswers={() => {}} onVoiceNote={() => void note.start()} />;
  }
  root = createRoot(host);
  await act(async () => root?.render(<Probe />));
  const selected = document.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')!;
  expect(selected.disabled).toBe(true);
  expect(selected.title).toBe("Oak already answers here.");
  const record = document.querySelector<HTMLButtonElement>('[data-testid="plus-voice-note"]')!;
  expect(record.disabled).toBe(false);
  await act(async () => record.click());
  expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
  expect(recording).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="voice-note"]')?.textContent).toContain("Recording a voice note");
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="voice-note"] button')!.click());
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(onFile).toHaveBeenCalledTimes(1);
  const file = onFile.mock.calls[0]![0] as File;
  expect(file.name).toBe("Voice note.webm");
  expect(file.type).toBe("audio/webm");
  expect(file.size).toBeGreaterThan(0);
  expect(onProblem).toHaveBeenCalledExactlyOnceWith(null);
});
