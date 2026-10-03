// The waiting card's keys (§4.2.3 Keyboard): Ctrl Enter allows once, Ctrl Shift Enter always allows, Ctrl D says no.
// One press does one thing: Ctrl Enter in the message box while it holds a draft (data-has-draft) sends that draft
// instead, and the waiting request is left for the next press.
import type { ApprovalDecision } from "./model";

type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey"> & { target: EventTarget | null };

export function approvalKeyFor(e: KeyLike): ApprovalDecision | null {
  if (!(e.ctrlKey || e.metaKey)) return null;
  if (e.key === "Enter") {
    if (e.shiftKey) return "allow-always";
    const t = e.target as Element | null;
    return t && typeof t.closest === "function" && t.closest("[data-has-draft]") ? null : "allow-once";
  }
  return e.key.toLowerCase() === "d" ? "deny" : null;
}
