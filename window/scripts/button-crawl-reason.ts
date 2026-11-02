// The button crawl's disabled-control rule (Private #1093 item 7): a visible control that is greyed (disabled, or
// aria-disabled) must say why in one visible line. Coming controls (their only reason is "not built yet") are hidden
// below Technical, so they are not on the page to check; a control greyed for a real condition says what to do.
//
// A reason counts when it is on the page as text a person can read:
//   - aria-describedby names an element that is visible and has text, or
//   - a visible note (a small line, a hint, a status) sits in the same row as the control.
// A tooltip (title) alone does not count: it shows only on hover, and never on touch.

/** The containers the window draws one setting, list item or menu entry in. */
export const REASON_ROW = ".r1s-row, .ctl, .prow, [data-row], [role=\"row\"], tr, li";
/** The elements a row says why in: the line under the control, a hint, or a status line. */
export const REASON_NOTE = "small, .r1s-note, .r1s-msg, .hint, .why-k, [role=\"status\"]";
/** The elements a person clicks; a note inside one is that control's own text, not a reason beside it. */
const CONTROL = "button, a[href], [role=\"button\"], [role^=\"menuitem\"], [role=\"tab\"], [role=\"switch\"], input, select, textarea";

const textIn = (node: Element) => (node.textContent || "").replace(/\s+/g, " ").trim();

/** True when the control is greyed: disabled, or aria-disabled="true". */
export function isGreyed(el: Element): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/** The visible reason for a greyed control, or "" when it has none. `visible` is the crawl's own visibility check. */
export function visibleReason(el: Element, visible: (node: Element) => boolean): string {
  const doc = el.ownerDocument;
  for (const id of (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)) {
    const node = doc.getElementById(id);
    if (node && visible(node) && textIn(node)) return textIn(node);
  }
  const row = el.parentElement?.closest(REASON_ROW);
  if (!row) return "";
  for (const note of row.querySelectorAll(REASON_NOTE)) {
    if (note.contains(el) || note.closest(CONTROL)) continue;
    if (visible(note) && textIn(note)) return textIn(note);
  }
  return "";
}

/** True when the rule fails: the control is visible and greyed, and nothing visible says why. An enabled or hidden
 *  control is never counted. */
export function disabledWithoutReason(el: Element, visible: (node: Element) => boolean): boolean {
  return visible(el) && isGreyed(el) && !visibleReason(el, visible);
}
