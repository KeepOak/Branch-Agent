import type { MenuItem } from "./Menu";
import { guideLinkItems } from "./guide-links";

/** Keep the help menu focused; setup, news and feature discovery have their own entry points. */
export function guideMenuItems(tour: () => void, open: (url: string) => void): MenuItem[] {
  return [
    { label: "Walkthrough", run: tour, testid: "guide-tour" },
    ...guideLinkItems(open),
  ];
}
