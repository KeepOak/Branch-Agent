// The row menu's copy items (DESIGN-SPEC §4.1.6 Copy submenu): the whole conversation as Markdown, read through
// chat.history with the export's own loader, or its ID. Toasts "Copied." or "Couldn't copy."
import type { WindowEngine } from "../connect/engine";
import { loadCompleteTranscript } from "../transcript-export/load";
import { eventsToMarkdown } from "../transcript-export/render";
import { notify } from "./notify";

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify("Copied.");
  } catch {
    notify("Couldn't copy.", { tone: "bad" }); // fakes-ok: DESIGN-SPEC §4.1.6 Copy submenu (main docs)
  }
}

export async function copyMarkdown(engine: WindowEngine, key: string, title: string): Promise<void> {
  try {
    const blocks = await loadCompleteTranscript(engine, key, new AbortController().signal);
    await copyText(eventsToMarkdown(blocks, { title, includeToolDetails: false, includeTimestamps: false }));
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    notify(/changed while/.test(text) ? "The conversation changed while copying. Try again." : "Couldn't copy.", { tone: "bad" }); // fakes-ok: DESIGN-SPEC §4.1.6 Copy submenu (main docs)
  }
}
