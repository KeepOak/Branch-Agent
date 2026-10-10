// The one Help menu in the top bar (audit DA-08): the page's own help on a Settings page, the walkthrough and
// guides, Keyboard shortcuts, then Docs and contact links. The profile menu and the conversation ⋯ menu hold no help rows.
import type { MenuItem } from "./Menu";
import type { GuideLinkItem } from "./guide-links";

export type HelpMenuContext = {
  /** On a Settings page: opens that page's own help next to the Help button. */
  pageHelp?: () => void;
  walkthrough: () => void;
  setup: () => void;
  news: () => void;
  canDo: () => void;
  shortcuts: () => void;
  /** Docs, Get help and Community (guide-links.ts). */
  links: GuideLinkItem[];
};

export function helpMenuItems(c: HelpMenuContext): MenuItem[] {
  return [
    ...(c.pageHelp ? [{ label: "Help for this page", run: c.pageHelp, testid: "help-page" }, { kind: "sep" as const }] : []),
    { label: "Take the walkthrough", hint: "2 min", run: c.walkthrough, testid: "guide-tour" },
    { label: "Set up Branch", hint: "3 min", run: c.setup, testid: "guide-setup" },
    { label: "What’s new", hint: "this version", run: c.news, testid: "guide-news" },
    { label: "What Branch can do", run: c.canDo, testid: "guide-cando" },
    { label: "Keyboard shortcuts", hint: "?", run: c.shortcuts, testid: "help-shortcuts" },
    { kind: "sep" },
    ...c.links,
  ];
}
