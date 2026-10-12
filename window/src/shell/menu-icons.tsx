// The small line icons the conversation ⋯ menu draws beside its rows (the preview's icon set, DESIGN-SPEC §2.9):
// 24×24 box, stroke 1.7, round caps, no fill, currentColor, 15 px.
import type { ReactNode } from "react";

const PATHS = {
  cols: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M12 4.5v15" /></>,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  chat: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
  box: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  panel: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M15 4.5v15" /></>,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.5a3 3 0 0 1 0 6M17 13.5a5.5 5.5 0 0 1 3.5 5.5" /></>,
  personMinus: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 11h6" /></>,
  doc: <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5V8h4M9 12.5h6M9 16h6" /></>,
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />,
  retry: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
  puzzle: <path d="M10 3.5a2 2 0 0 1 4 0V6h4.5v4.5H16a2 2 0 0 0 0 4h2.5V19H14v-2.5a2 2 0 0 0-4 0V19H5.5v-4.5H8a2 2 0 0 0 0-4H5.5V6H10z" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  list: <path d="M8 6.5h11M8 12h11M8 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  pin: <path d="M9 4h6l-1 5 3.5 3.5h-11L10 9zM12 12.5V20" />,
  bell: <><path d="M6 17h12l-1.5-2V10a4.5 4.5 0 0 0-9 0v5zM10 20h4" /></>,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  teach: <><path d="M3 8.5L12 4l9 4.5-9 4.5z" /><path d="M7 10.5V15c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5" /></>,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  wave: <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h-2" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.5v.1" /></>,
  tree: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8M8 6h3a5 5 0 0 1 5 5" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
} satisfies Record<string, ReactNode>;

export type MenuIconName = keyof typeof PATHS;

export function menuIcon(name: MenuIconName): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
