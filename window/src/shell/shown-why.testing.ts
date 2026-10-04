// For tests: the developer notes (shown-why.ts) a person could see or hear in a rendered tree.
import { DEV_NOTES } from "./shown-why";

const SEEN_ATTRS = ["title", "aria-label", "aria-description", "aria-valuetext", "placeholder", "alt"];
const hasNote = (text: string | null | undefined): boolean => Boolean(text) && DEV_NOTES.some((note) => text!.includes(note));

/** Every place a developer note shows: the text, a tooltip or label attribute, or an aria-describedby target. */
export function visibleDevNotes(root: Element): string[] {
  const found: string[] = [];
  if (hasNote(root.textContent)) found.push(`text: ${root.textContent}`);
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const name of SEEN_ATTRS) {
      const value = el.getAttribute(name);
      if (hasNote(value)) found.push(`${el.tagName.toLowerCase()}[${name}]: ${value}`);
    }
    for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      const text = el.ownerDocument.getElementById(id)?.textContent;
      if (hasNote(text)) found.push(`${el.tagName.toLowerCase()}[aria-describedby]: ${text}`);
    }
  }
  return found;
}
