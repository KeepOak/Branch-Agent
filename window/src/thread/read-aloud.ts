// Read aloud (DESIGN-SPEC §4.2.6): the engine's own voice (talk.speak) reads one reply; when the engine has no
// speech service, this computer's voice (speechSynthesis) reads it instead, as the preview does.
import type { WindowEngine } from "../connect/engine";

let playing: { key: string; stop: () => void } | null = null;

/** The words worth speaking: the reply without Markdown marks, code fences or links' addresses. */
export function speakable(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readingKey(): string | null {
  return playing?.key ?? null;
}

export function stopReading(): void {
  playing?.stop();
  playing = null;
}

function speakHere(text: string, done: () => void): () => void {
  const ss = window.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === "undefined") throw new Error("Couldn’t read it aloud: no voice on this computer.");
  ss.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = done;
  u.onerror = done;
  ss.speak(u);
  return () => ss.cancel();
}

/** Reads `text` aloud; `onEnd` runs when it finishes or is stopped. */
export async function readAloud(engine: WindowEngine | undefined, key: string, text: string, onEnd: () => void): Promise<void> {
  stopReading();
  const words = speakable(text);
  const finish = () => {
    if (playing?.key === key) playing = null;
    onEnd();
  };
  try {
    if (!engine) throw new Error("no engine");
    const r = (await engine.request("talk.speak", { text: words })) as { audioBase64?: string; mimeType?: string };
    if (!r?.audioBase64) throw new Error("no audio");
    const audio = new Audio(`data:${r.mimeType || "audio/mpeg"};base64,${r.audioBase64}`);
    audio.onended = finish;
    playing = { key, stop: () => { audio.pause(); finish(); } };
    await audio.play();
  } catch {
    try {
      playing = { key, stop: speakHere(words, finish) };
    } catch {
      finish();
    }
  }
}
