import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type Layer = { element: HTMLElement; returns: HTMLElement[] };
const layers: Layer[] = [];
const editable = '[contenteditable]:not([contenteditable="false"])';
const candidates = `button, input:not([type="hidden"]), select, textarea, a[href], [tabindex], ${editable}`;
// An editing host without its own tabindex is in the Tab order even where the DOM reports tabIndex -1.
const tabbable = (item: HTMLElement) => item.tabIndex >= 0 || (item.matches(editable) && !item.hasAttribute("tabindex"));
function controls(element: HTMLElement) {
  return [...element.querySelectorAll<HTMLElement>(candidates)].filter((item) =>
    tabbable(item) && !item.matches(":disabled") && !item.closest('[hidden], [inert], [aria-hidden="true"]') &&
    getComputedStyle(item).display !== "none" && getComputedStyle(item).visibility !== "hidden");
}
// Safari reports the Escape that commits an IME choice with keyCode 229 and isComposing false.
const composing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

/**
 * Shared keyboard lifecycle for dialogs, menus and popovers. Only the top layer handles Escape, and only after the
 * event bubbles past React: an inner field that handles Escape itself (preventDefault or stopPropagation) wins.
 * Without `onClose` the layer keeps focus and Tab handling but leaves Escape alone (the remote desktop while driving).
 * Prior art: OpenClaw's ui/src/components/modal-dialog.ts (initial focus, return focus that skips inert or disabled targets).
 */
export function useOverlayFocus(ref: RefObject<HTMLElement | null>, onClose: (() => void) | undefined, options: { modal?: boolean; trigger?: HTMLElement | null; initial?: string } = {}) {
  const latest = useRef({ onClose, options });
  // Capture before React commits descendant autoFocus fields or removes a launching menu.
  const [returns] = useState(() => [options.trigger, document.activeElement, ...layers.slice().reverse().flatMap((layer) => layer.returns)]
    .filter((item): item is HTMLElement => item instanceof HTMLElement && item !== document.body));
  useLayoutEffect(() => { latest.current = { onClose, options }; });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const layer = { element, returns };
    layers.push(layer);
    const top = () => layers.at(-1) === layer;
    const focusFirst = () => {
      const preferred = latest.current.options.initial ? element.querySelector<HTMLElement>(latest.current.options.initial) : null;
      (preferred && controls(element).includes(preferred) ? preferred : controls(element)[0] ?? element).focus({ preventScroll: true });
    };
    if (!element.contains(document.activeElement)) focusFirst();
    const key = (event: KeyboardEvent) => {
      if (!top() || event.defaultPrevented || composing(event)) return;
      const close = latest.current.onClose;
      if (event.key === "Escape" && close) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === "Tab" && latest.current.options.modal) {
        const items = controls(element);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length || index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
          event.preventDefault();
          (event.shiftKey ? items.at(-1) ?? element : items[0] ?? element).focus({ preventScroll: true });
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (top() && latest.current.options.modal && !element.contains(event.target as Node)) focusFirst();
    };
    // Bubble phase: React's root listener runs first, so inner handlers keep priority over closing the overlay.
    document.addEventListener("keydown", key);
    document.addEventListener("focusin", focus);
    return () => {
      const wasTop = top();
      layers.splice(layers.indexOf(layer), 1);
      document.removeEventListener("keydown", key);
      document.removeEventListener("focusin", focus);
      // Wait for removed parent menus to detach and replacement dialogs to autofocus.
      // StrictMode's effect replay keeps the same panel registered and must not restore out of it.
      queueMicrotask(() => {
        if (!wasTop || layers.some((entry) => entry.element === element)) return;
        const active = document.activeElement;
        if (!active || active === document.body || element.contains(active)) {
          for (const item of returns) {
            if (!item.isConnected || element.contains(item) || item.matches(":disabled") || item.closest("[inert]")) continue;
            item.focus({ preventScroll: true });
            if (document.activeElement === item) break;
          }
        }
      });
    };
  }, [ref, returns]);
  return returns[0] ?? null;
}
