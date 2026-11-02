// One tab's page: a webview that stays mounted while the tab is in the background, so the page keeps its state.
import { createElement, useEffect, useRef, useState, type RefObject } from "react";
import type { GuestTab } from "./guest-tabs";
import { guestAddress } from "./guest-drive";
import { WEBVIEW_TAG, type GuestElement } from "./webview-tag";

/** What a tab learns from its page. */
export type TabReport = Partial<Omit<GuestTab, "id">>;

type Handlers = { onReport(id: string, patch: TabReport): void; onPopup(url: string): void };

type Props = {
  tab: GuestTab;
  active: boolean;
  register(id: string, el: GuestElement | null): void;
  onReport(id: string, patch: TabReport): void;
  onPopup(url: string): void;
};

export function GuestTabView({ tab, active, register, onReport, onPopup }: Props) {
  const ref = useRef<HTMLElement | null>(null);
  // The address is given to the webview once, when it is made. Later moves go through loadURL.
  const [startUrl] = useState(tab.url);
  const handlers = useRef<Handlers>({ onReport, onPopup });
  handlers.current = { onReport, onPopup };
  useEffect(() => {
    const el = ref.current as GuestElement | null;
    if (!el) return;
    register(tab.id, el);
    const off = listenToPage(el, tab.id, handlers);
    return () => {
      off();
      register(tab.id, null);
    };
  }, [tab.id, register]);
  return (
    <div className="guest-tab" data-active={active ? "true" : "false"}>
      {createElement(WEBVIEW_TAG, { ref, className: "guest-page", src: startUrl, partition: "persist:branch-browser", allowpopups: "true" })}
    </div>
  );
}

/** Keeps the tab's report current from the page's events. Returns the function that removes them. */
function listenToPage(el: GuestElement, id: string, handlers: RefObject<Handlers>): () => void {
  const navigated = () => handlers.current?.onReport(id, { url: el.getURL(), canGoBack: el.canGoBack(), canGoForward: el.canGoForward() });
  const listeners: Array<[string, (event: Event) => void]> = [
    ["did-navigate", navigated],
    ["did-navigate-in-page", navigated],
    ["page-title-updated", () => handlers.current?.onReport(id, { title: el.getTitle() })],
    ["did-start-loading", () => handlers.current?.onReport(id, { loading: true })],
    ["did-stop-loading", () => handlers.current?.onReport(id, { loading: false })],
    ["new-window", (event) => popupAddress(event, handlers)],
  ];
  for (const [name, listener] of listeners) el.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of listeners) el.removeEventListener(name, listener);
  };
}

function popupAddress(event: Event, handlers: RefObject<Handlers>): void {
  const url = (event as Event & { url?: unknown }).url;
  if (typeof url !== "string") return;
  const safe = guestAddress(url);
  if (safe) handlers.current?.onPopup(safe);
}
