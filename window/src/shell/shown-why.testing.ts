// For tests: the developer notes (shown-why.ts) a person could see or hear in a rendered tree.
import { isDevNote } from "./shown-why";

const SEEN_ATTRS = ["title", "aria-label", "aria-description", "aria-valuetext", "placeholder", "alt"];

/** Every place a developer note shows: a text node, a tooltip or label attribute, or an aria-describedby target. */
export function visibleDevNotes(root: Element): string[] {
  const found: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (isDevNote(text)) found.push(`text: ${text}`);
  }
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const name of SEEN_ATTRS) {
      const value = el.getAttribute(name);
      if (isDevNote(value)) found.push(`${el.tagName.toLowerCase()}[${name}]: ${value}`);
    }
    for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
      const text = el.ownerDocument.getElementById(id)?.textContent;
      if (isDevNote(text)) found.push(`${el.tagName.toLowerCase()}[aria-describedby]: ${text}`);
    }
  }
  return found;
}
