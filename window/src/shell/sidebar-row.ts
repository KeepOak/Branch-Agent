// Shared rules for a Recent row: the same actions, the same open, a display name, and a card that stays off the list.

export const MAIN_ARCHIVE_REASON = "The main conversation can’t be archived.";

const RAW_ID = /^[a-z0-9_-]+(?::[a-z0-9_-]+)+$/;

export type Box = { left: number; top: number; right: number; bottom: number };

/** A colon-separated session id, such as agent:researcher:main. Ordinary titles are left alone. */
export function isRawId(value: string): boolean {
  return RAW_ID.test(value.trim());
}

function humanizeAgentId(value: string): string {
  const parts = value.trim().split(":");
  const agent = parts[0] === "agent" && parts.length >= 2 ? parts[1] ?? "" : parts[0] ?? "";
  const words = agent.replace(/[_-]+/g, " ").trim();
  if (!words) return "New conversation";
  return words.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

/** The name a Recent row shows. A raw id never reaches the list. */
export function rowDisplayName(title: string, trunkName: string): string {
  const name = title.trim();
  if (!name || !isRawId(name)) return name;
  const trunk = trunkName.trim();
  if (trunk && !isRawId(trunk)) return trunk;
  return humanizeAgentId(name);
}

/** The letter drawn when a row has no face. */
export function rowInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)][0]?.segment ?? "?";
  return first.toLocaleUpperCase();
}

export type ArchiveOffer = { visible: boolean; disabled: boolean; label: string; title: string };

/** Every Recent row offers Archive. The local Trunk keeps the button, disabled, with the reason. */
export function archiveOffer(row: { key: string; archived?: boolean }, homeKey: string | null | undefined, child: boolean): ArchiveOffer {
  if (child) return { visible: false, disabled: false, label: "Archive", title: "Archive" };
  const label = row.archived ? "Restore" : "Archive";
  if (!row.archived && homeKey && row.key === homeKey) {
    return { visible: true, disabled: true, label: "Archive", title: MAIN_ARCHIVE_REASON };
  }
  return { visible: true, disabled: false, label, title: label };
}

/** Opening a conversation does not collapse the sidebar. The rail is only the layout the owner chose. */
export function sidebarRailForOpen(layoutRail: boolean, _open: { hasTopics?: boolean; wide?: boolean; topicLayout?: string } = {}): boolean {
  return layoutRail;
}

/** Header count for a thread list that always includes General plus the topic rows. */
export function threadCountLabel(topicCount: number): string {
  const count = topicCount + 1;
  return `${count} ${count === 1 ? "thread" : "threads"}`;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Place the hover card so it misses the conversation list and the thread pane. */
export function rowCardPosition(input: {
  anchor: Box;
  sidebar: Box;
  thread: Box | null;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
}): { left: number; top: number } {
  const gap = 8;
  const top = Math.max(gap, Math.min(input.anchor.top, input.viewport.height - input.card.height - gap));
  const fits = (left: number) => {
    const box = { left, top, right: left + input.card.width, bottom: top + input.card.height };
    if (box.left < gap || box.right > input.viewport.width - gap) return false;
    if (overlaps(box, input.sidebar)) return false;
    if (input.thread && overlaps(box, input.thread)) return false;
    return true;
  };
  const candidates = [
    input.sidebar.right + gap,
    input.thread ? input.thread.right + gap : null,
    input.sidebar.left - gap - input.card.width,
  ];
  for (const left of candidates) {
    if (left !== null && fits(left)) return { left, top };
  }
  const beside = input.thread ? input.thread.right + gap : input.sidebar.right + gap;
  return { left: Math.max(input.sidebar.right + gap, beside), top };
}
