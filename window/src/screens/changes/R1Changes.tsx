import { useEffect } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Icon } from "../../shell/icons";
import { ChangesTab } from "../../stage/coding/ChangesTab";
import "./r1-changes.css";

/** The engine call the re-hosted view reads first; the ••• row that opens it is Coming without it (R1-10). */
export const CHANGES_NEED = "sessions.diff";

/** Where focus goes back to when the view closes: the ••• button whose menu opened it. */
const OPENER = '.r1-header-right [aria-label="More"]';

/**
 * The Classic Changes view (the full diff with its scope, split, wrap and Sync, and the pull request box under it),
 * re-hosted unchanged inside the R1 frame (parity row 4). Only this wrapper is R1: a clear glass surface (README item 48)
 * that fills the conversation's main column above the one composer, as the computer stage does (parity row 1). Its title
 * and the conversation's name sit on frosted pills; × and Escape close it and hand focus back to •••.
 */
export function R1Changes({ engine, name, onClose }: { engine: WindowEngine; name: string; onClose: () => void }) {
  const close = () => { onClose(); document.querySelector<HTMLElement>(OPENER)?.focus(); };
  useEffect(() => {
    // Escape closes the view unless a menu, dialog or popover of the view is open: those take Escape first.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')) return;
      onClose(); document.querySelector<HTMLElement>(OPENER)?.focus();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  return <section className="r1-changes g-clear" aria-label={`${name || "Conversation"}'s changes`}>
    <div className="r1-changes-top">
      <h2 className="g-label">Changes</h2>
      {name ? <span className="g-label r1-changes-name">{name}</span> : null}
      <span className="r1-changes-grow" />
      <button type="button" className="r1-changes-close" data-local="" aria-label="Close changes" title="Close" onClick={close}><Icon name="x" /></button>
    </div>
    <ChangesTab engine={engine} />
  </section>;
}
