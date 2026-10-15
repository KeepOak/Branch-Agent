// The owner's tabs in the browser pane: which tabs are open, which one shows, and what each page reports.
// Pure, so the pane's state can be tested without the webviews.

export type GuestTab = {
  id: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type GuestTabs = { tabs: GuestTab[]; activeId: string | null; nextId: number };

export type GuestTabAction =
  | { type: "open"; url?: string }
  | { type: "close"; id: string }
  | { type: "activate"; id: string }
  | { type: "update"; id: string; patch: Partial<Omit<GuestTab, "id">> };

export const EMPTY_TABS: GuestTabs = { tabs: [], activeId: null, nextId: 1 };

/** The pane's first state: one tab on the address, or no tab at all. */
export function initialTabs(url?: string): GuestTabs {
  return url ? reduceTabs(EMPTY_TABS, { type: "open", url }) : EMPTY_TABS;
}

export function reduceTabs(state: GuestTabs, action: GuestTabAction): GuestTabs {
  switch (action.type) {
    case "open":
      return openTab(state, action.url || "about:blank");
    case "close":
      return closeTab(state, action.id);
    case "activate":
      return state.tabs.some((tab) => tab.id === action.id) ? { ...state, activeId: action.id } : state;
    case "update":
      return {
        ...state,
        tabs: state.tabs.map((tab) => (tab.id === action.id ? { ...tab, ...action.patch } : tab)),
      };
  }
}

/** The title a tab shows: the page's own title, else its address, else "New tab". */
export function tabLabel(tab: GuestTab): string {
  if (tab.title) return tab.title;
  return tab.url && tab.url !== "about:blank" ? tab.url : "New tab";
}

function openTab(state: GuestTabs, url: string): GuestTabs {
  const id = `tab-${state.nextId}`;
  const tab: GuestTab = { id, url, title: "", loading: false, canGoBack: false, canGoForward: false };
  return { tabs: [...state.tabs, tab], activeId: id, nextId: state.nextId + 1 };
}

/** Closing the showing tab moves to its neighbour, the one after it when it was first. */
function closeTab(state: GuestTabs, id: string): GuestTabs {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.activeId !== id) return { ...state, tabs };
  const next = tabs[index] ?? tabs[index - 1];
  return { ...state, tabs, activeId: next ? next.id : null };
}
