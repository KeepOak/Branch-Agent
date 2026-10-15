// The owner's browser pane's state: its tabs, what each page reports, the live webviews, and the actions on them.
import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { resolveBrowserInput } from "../stage/browser-input";
import { guestAccess as sharedAccess, type GuestAccessStore } from "./guest-access";
import { guestAddress } from "./guest-drive";
import type { GuestEngine } from "./guest-host";
import type { GuestBridge } from "./guest-bridge";
import { initialTabs, reduceTabs, type GuestTabs } from "./guest-tabs";
import { useGuestHost } from "./use-guest-host";
import type { TabReport } from "./GuestTabView";
import type { GuestElement } from "./webview-tag";

/** A page that asks for a new window twice within this time opens one tab (both the page event and the host event may fire). */
const POPUP_REPEAT_MS = 1000;

export type GuestPaneOptions = {
  startUrl?: string;
  engine?: GuestEngine;
  sessionKey?: string | null;
  access?: GuestAccessStore;
  bridge: GuestBridge | null;
};

export function useGuestPane({ startUrl, engine, sessionKey = null, access = sharedAccess, bridge }: GuestPaneOptions) {
  const [tabs, dispatch] = useReducer(reduceTabs, startUrl, initialTabs);
  const tabsRef = useRef<GuestTabs>(tabs);
  tabsRef.current = tabs;
  const views = useRef(new Map<string, GuestElement>());
  const lastPopup = useRef({ url: "", at: 0 });
  const state = useSyncExternalStore(access.subscribe, () => access.state(sessionKey ?? ""));
  const active = tabs.tabs.find((tab) => tab.id === tabs.activeId) ?? null;
  const tabKey = tabs.tabs.map((tab) => tab.id).join(" ");

  const register = useCallback((id: string, el: GuestElement | null) => {
    if (el) views.current.set(id, el);
    else views.current.delete(id);
  }, []);
  const activeView = useCallback((): GuestElement | null => {
    const id = tabsRef.current.activeId;
    return id ? views.current.get(id) ?? null : null;
  }, []);
  const openTab = useCallback((url: string) => dispatch({ type: "open", url }), []);
  const report = useCallback((id: string, patch: TabReport) => dispatch({ type: "update", id, patch }), []);
  const popup = useCallback((url: string) => {
    const safe = guestAddress(url);
    const now = Date.now();
    if (!safe || (safe === lastPopup.current.url && now - lastPopup.current.at < POPUP_REPEAT_MS)) return;
    lastPopup.current = { url: safe, at: now };
    openTab(safe);
  }, [openTab]);
  useEffect(() => bridge?.onOpenTab(popup), [bridge, popup]);

  useGuestHost({
    engine,
    sessionKey,
    access,
    tabsRef,
    page: activeView,
    openTab,
    ready: tabs.tabs.length > 0,
    tabKey,
  });

  const go = (raw: string) => {
    const input = resolveBrowserInput(raw);
    if (input.kind === "empty") return;
    if (!active) {
      openTab(input.url);
      return;
    }
    report(active.id, { url: input.url, loading: true });
    void Promise.resolve(activeView()?.loadURL(input.url)).catch(() => undefined);
  };

  return {
    tabs,
    active,
    state,
    register,
    report,
    popup,
    openTab,
    go,
    activeView,
    activate: (id: string) => dispatch({ type: "activate", id }),
    closeTab: (id: string) => dispatch({ type: "close", id }),
    back: () => activeView()?.goBack(),
    forward: () => activeView()?.goForward(),
    reload: () => activeView()?.reload(),
    access,
  };
}
