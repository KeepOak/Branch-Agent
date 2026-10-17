// Where a walkthrough coach card sits. It stays inside the window, off the sidebar, and off the control it points at.
export type Box = { top: number; left: number; width: number; height: number };

const GAP = 12;
const EDGE = 12;

function hits(card: Box, zone: Box): boolean {
  return card.left < zone.left + zone.width - 0.5
    && card.left + card.width > zone.left + 0.5
    && card.top < zone.top + zone.height - 0.5
    && card.top + card.height > zone.top + 0.5;
}

/** Where the coach card sits: off the sidebar, and off the control it points at. */
export function coachCardPlace(
  target: Box | null,
  size: { width: number; height: number },
  view: { width: number; height: number },
  sidebar: Box | null,
): { top: number; left: number; maxWidth: number } {
  const width = view.width;
  const height = view.height;
  const side = sidebar && sidebar.width >= 8 && sidebar.height >= 8 && sidebar.left < width - 8 ? sidebar : null;
  const minLeft = side ? side.left + side.width + GAP : EDGE;
  const maxWidth = Math.max(160, Math.min(340, width - minLeft - EDGE));
  const cardWidth = Math.min(Math.max(size.width, 1), maxWidth);
  const cardHeight = Math.max(size.height, 1);
  const clear = (top: number, left: number) => {
    if (left < minLeft - 0.5 || top < EDGE - 0.5 || left + cardWidth > width - EDGE + 0.5 || top + cardHeight > height - EDGE + 0.5) return false;
    const card = { top, left, width: cardWidth, height: cardHeight };
    if (side && hits(card, side)) return false;
    if (target && hits(card, target)) return false;
    return true;
  };
  const spots: { top: number; left: number }[] = [];
  if (!target) {
    const room = width - minLeft - EDGE;
    spots.push({ top: Math.max(EDGE, (height - cardHeight) / 2), left: room >= cardWidth ? minLeft + (room - cardWidth) / 2 : minLeft });
  } else {
    const align = Math.max(target.left, minLeft);
    const right = Math.max(target.left + target.width + GAP, minLeft);
    spots.push(
      { top: target.top + target.height + GAP, left: align },
      { top: target.top - cardHeight - GAP, left: align },
      { top: target.top, left: right },
      { top: Math.max(EDGE, target.top + target.height - cardHeight), left: right },
    );
  }
  for (const spot of spots) {
    const left = Math.min(Math.max(spot.left, minLeft), width - cardWidth - EDGE);
    const top = Math.min(Math.max(spot.top, EDGE), height - cardHeight - EDGE);
    if (clear(top, left)) return { top, left, maxWidth };
  }
  for (let top = EDGE; top + cardHeight <= height - EDGE; top += 16) {
    for (let left = minLeft; left + cardWidth <= width - EDGE; left += 16) {
      if (clear(top, left)) return { top, left, maxWidth };
    }
  }
  return { top: EDGE, left: Math.min(minLeft, Math.max(EDGE, width - cardWidth - EDGE)), maxWidth };
}
