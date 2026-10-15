// Keeps the gateway host attached for this pane's conversation, and tells it whenever a live tab opens or closes.
import { useEffect, useRef, type MutableRefObject } from "react";
import type { GuestAccessStore } from "./guest-access";
import { attachGuestHost, type GuestEngine, type GuestHost, type GuestPageSource } from "./guest-host";
import type { GuestTabs } from "./guest-tabs";
import type { GuestWebview } from "./guest-drive";

export type GuestHostWiring = {
  engine?: GuestEngine;
  sessionKey: string | null;
  access: GuestAccessStore;
  tabsRef: MutableRefObject<GuestTabs>;
  page: () => GuestWebview | null;
  openTab: (url: string) => void;
  ready: boolean;
  tabKey: string;
};

export function useGuestHost({ engine, sessionKey, access, tabsRef, page, openTab, ready, tabKey }: GuestHostWiring): void {
  const hostRef = useRef<GuestHost | null>(null);
  useEffect(() => {
    if (!engine || !sessionKey) return;
    const source: GuestPageSource = { tabs: () => listTabs(tabsRef.current), page, openTab };
    const host = attachGuestHost({ engine, sessionKey, access, source });
    hostRef.current = host;
    return () => {
      host.dispose();
      hostRef.current = null;
    };
  }, [engine, sessionKey, access, tabsRef, page, openTab]);
  useEffect(() => {
    hostRef.current?.setReady(ready);
  }, [engine, sessionKey, ready, tabKey]);
  // A reconnect gives the engine a new connection, which has forgotten this pane. Announce again on each reconnect.
  const connected = engine?.connected;
  useEffect(() => {
    if (connected) hostRef.current?.resendReady();
  }, [connected, engine, sessionKey]);
}

/** The tab list the Trunk sees: each tab's id is its targetId. */
export function listTabs(state: GuestTabs) {
  return {
    tabs: state.tabs.map(({ id, title, url }) => ({ targetId: id, title, url })),
    activeTargetId: state.activeId,
  };
}
