// The line icon set (DESIGN-SPEC §2.9): one stroke set on a 24×24 box, stroke 1.7, round caps and joins,
// no fill, currentColor. Default 18 px; small (`s`) 15 px.
import type { ReactNode } from "react";

const PATHS = {
  globe: <><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a15 15 0 0 1 0 16 15 15 0 0 1 0-16"/></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  home: <path d="M4 11l8-6.5 8 6.5M6.5 9.5V19h11V9.5" />,
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M10 10v9.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13l2.5-7.5h11L20 13v5.5H4z" />
      <path d="M4 13h4.5l1.2 2.5h4.6l1.2-2.5H20" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  book: <path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2zM5 19.5a2 2 0 0 0 2 1h12" />,
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 6M17.5 14.6c1.6.6 2.7 2 3 4.4" />
    </>
  ),
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5l1.6 2.2 2.7-.5.8 2.6 2.5 1.2-.9 2.6.9 2.6-2.5 1.2-.8 2.6-2.7-.5L12 20.5l-1.6-2.2-2.7.5-.8-2.6-2.5-1.2.9-2.6-.9-2.6 2.5-1.2.8-2.6 2.7.5z" />
    </>
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  chev: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  x: <path d="M7 7l10 10M17 7L7 17" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  pin: <path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8" />,
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5v11h14v-11M10 12.5h4" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />,
  edit: <path d="M14.5 5.5l4 4L9 19H5v-4z" />,
  folder: <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  sidebarOff: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15M4 4l16 16" />
    </>
  ),
  help: <path d="M9.5 18h5M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4" />,
  snooze: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9.5V13l2.5 1.5M5 4l-2 2M19 4l2 2" />
    </>
  ),
  unread: <circle cx="12" cy="12" r="4" />,
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M5 15.5V6a1.5 1.5 0 0 1 1.5-1.5H15" />
    </>
  ),
  window: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9h17" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />,
  retry: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  spin: <path d="M12 4a8 8 0 1 1-8 8" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12.5l8-8M16 7.5l2.5 2.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  chat: <path d="M4 5.5h16v10H9l-5 4z" />,
  ask: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01" />
    </>
  ),
  external: <path d="M13.5 5.5H18.5v5M18.5 5.5 11 13M16 14v4.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1H11" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  back: <path d="M15 6l-6 6 6 6" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17h.01" /></>,
  box: <><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" /></>,
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.1 4.75 4.75 0 0 0 7 18.5z" />,
  pr: <><circle cx="6.5" cy="5.5" r="2" /><circle cx="6.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /><path d="M6.5 7.5v9M17.5 16.5V10a3 3 0 0 0-3-3h-4M12 4.5 9.5 7l2.5 2.5" /></>,
  eyeOff: <><path d="M3.5 3.5l17 17M10.6 6.1A9 9 0 0 1 12 6c5 0 8.5 6 8.5 6a15 15 0 0 1-2.6 3.3M6.6 7.7C4.6 9.2 3.5 12 3.5 12s3.5 6 8.5 6a8.6 8.6 0 0 0 4-1" /><path d="M9.9 10.1a3 3 0 0 0 4 4" /></>,
  tick: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  code: <path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4" />,
  board: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15M15 4.5v15" /></>,
  coins: <><ellipse cx="12" cy="7" rx="6.5" ry="2.5" /><path d="M5.5 7v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V7M5.5 12v5c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-5" /></>,
  bookOpen: <><path d="M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z" /><path d="M5 16.5a3 3 0 0 1 3-3h10.5" /></>,
  branch: <><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7.5v9M18 10c0 4-6 3.5-10.5 7" /></>,
  term: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" /></>,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  camera: <><rect x="3" y="6" width="18" height="13" rx="2" /><circle cx="12" cy="12.5" r="3.5" /><path d="M9 6l1.5-2h3L15 6" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></>,
  shield: <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />,
  cols: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M12 4.5v15" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, small, size }: { name: IconName; small?: boolean; size?: number }) {
  const px = size ?? (small ? 15 : 18);
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
    >
      {PATHS[name]}
    </svg>
  );
}
