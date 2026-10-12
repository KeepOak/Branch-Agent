// The Coming state (R1-10, preview `off18`): a control whose engine call this engine doesn't offer is drawn greyed with
// its one-line reason as the tooltip, and clicking it runs nothing. Every control declares the call it needs:
//   <Coming need="channels.add" reason="Setting up Slack comes in a later update."><button …>Add</button></Coming>
// A control that needs no engine call (open a menu, go back) says so with data-local. In dev builds every Coming
// control registers itself (coming-registry.ts), and window.__branchComing() lists them.
import { cloneElement, useEffect, useId, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import { availability, useCapabilityEngine, useCapabilityVersion } from "../connect/capabilities";
import type { WindowEngine } from "../connect/engine";
import { COMING_REASON, registerComing, type ComingEntry } from "./coming-registry";

export type ComingProps = {
  /** The gateway method (or methods) the control calls. */
  need: string | readonly string[];
  /** One plain line, no dates (the preview's WHY_F18 / WHY_PF18 copy). */
  reason?: string;
  /** Names the control in the dev list; defaults to its aria-label, title or text. */
  where?: string;
  /** The owner said hidden, not greyed (+ menu items, "Open in new window"): render nothing, still register. */
  hidden?: boolean;
  /** Checks against this engine instead of the CapabilityProvider's. */
  engine?: Pick<WindowEngine, "features"> | null;
  /** One element that passes DOM props through (aria-disabled, title, style, the click handlers). */
  children: ReactElement;
};

type ChildProps = { "aria-label"?: unknown; title?: unknown; children?: unknown; style?: Record<string, unknown> };

const swallow = (event: MouseEvent | KeyboardEvent) => {
  event.preventDefault();
  event.stopPropagation();
};
const swallowKeys = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") swallow(event);
};

function labelOf(child: ReactElement): string {
  const props = child.props as ChildProps;
  if (typeof props["aria-label"] === "string") return props["aria-label"];
  if (typeof props.title === "string") return props.title;
  if (typeof props.children === "string") return props.children;
  return typeof child.type === "string" ? child.type : "control";
}

export function Coming({ need, reason, where, hidden = false, engine, children }: ComingProps): ReactElement | null {
  const fromContext = useCapabilityEngine();
  useCapabilityVersion();
  const id = useId();
  const needs = typeof need === "string" ? [need] : [...need];
  const target = engine === undefined ? fromContext : engine;
  // Before the first hello nothing is known: draw the control as it is rather than flash Coming and back.
  const missing = needs.filter((method) => availability(target, method) === "no");
  const why = reason ?? COMING_REASON;
  const entry: ComingEntry | null = missing.length ? { need: needs, missing, reason: why, where: where ?? labelOf(children), hidden } : null;
  const entryKey = entry ? JSON.stringify(entry) : "";
  useEffect(() => (entryKey ? registerComing(id, JSON.parse(entryKey) as ComingEntry) : undefined), [id, entryKey]);
  if (!entry) return cloneElement(children, { "data-need": needs.join(" ") } as Record<string, unknown>);
  if (hidden) return null;
  const props = children.props as ChildProps;
  return cloneElement(children, {
    "aria-disabled": "true",
    "data-coming": why,
    title: why,
    onClick: swallow,
    onClickCapture: swallow,
    onKeyDownCapture: swallowKeys,
    style: { ...props.style, opacity: 0.55, cursor: "not-allowed" },
  } as Record<string, unknown>);
}
