// Where a walkthrough coach card sits. It stays inside the window, off the sidebar, off the control it points at, and
// off the mascot (the Trunk's face on an empty conversation, its character and the pet).
export type Box = { top: number; left: number; width: number; height: number };

const GAP = 12;
const EDGE = 12;
/** Space kept between a squeezed card and what it stays off. */
const SQUEEZE_GAP = 8;
/** A squeezed card shorter than this would not show its buttons and a line of text, so the card keeps its full height. */
const MIN_SQUEEZED = 96;

/** True when two boxes overlap. Used so a spotlight in the sidebar is skipped. */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.left + b.width - 0.5
    && a.left + a.width > b.left + 0.5
    && a.top < b.top + b.height - 0.5
    && a.top + a.height > b.top + 0.5;
}

/** The free stretch of rows in the window that a card from `left` to `right` can use, longest first, between the boxes it crosses. */
function freeRows(left: number, right: number, blocks: Box[], height: number): { top: number; length: number } {
  const crossing = blocks
    .filter((b) => b.left < right - 0.5 && b.left + b.width > left + 0.5)
    .map((b) => ({ from: b.top - SQUEEZE_GAP, to: b.top + b.height + SQUEEZE_GAP }))
    .sort((a, b) => a.from - b.from);
  let best = { top: EDGE, length: 0 };
  let at = EDGE;
  for (const block of [...crossing, { from: height - EDGE, to: height - EDGE }]) {
    const end = Math.min(block.from, height - EDGE);
    if (end - at > best.length) best = { top: at, length: end - at };
    at = Math.max(at, block.to);
  }
  return best;
}

/**
 * Where the coach card sits: off the sidebar, off the control it points at, and off the mascots. When no full-height
 * spot is free of all of them (the smallest window), the card takes the tallest free stretch and gets a maxHeight.
 */
export function coachCardPlace(
  target: Box | null,
  size: { width: number; height: number },
  view: { width: number; height: number },
  sidebar: Box | null,
  mascots: Box[] = [],
): { top: number; left: number; maxWidth: number; maxHeight?: number } {
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
    if (side && overlaps(card, side)) return false;
    if (target && overlaps(card, target)) return false;
    if (mascots.some((mascot) => overlaps(card, mascot))) return false;
    return true;
  };
  const spots: { top: number; left: number }[] = [];
  if (!target) {
    const room = width - minLeft - EDGE;
    const centre = room >= cardWidth ? minLeft + (room - cardWidth) / 2 : minLeft;
    spots.push({ top: Math.max(EDGE, (height - cardHeight) / 2), left: centre });
    for (const mascot of mascots) spots.push({ top: mascot.top + mascot.height + GAP, left: centre }, { top: mascot.top - cardHeight - GAP, left: centre });
  } else {
    const align = Math.max(target.left, minLeft);
    const right = Math.max(target.left + target.width + GAP, minLeft);
    const below = target.top + target.height + GAP;
    const above = target.top - cardHeight - GAP;
    spots.push({ top: below, left: align });
    // Still under (or over) the control, but beside a mascot that sits there.
    for (const mascot of mascots) spots.push({ top: below, left: mascot.left - GAP - cardWidth }, { top: below, left: mascot.left + mascot.width + GAP });
    spots.push({ top: above, left: align });
    for (const mascot of mascots) spots.push({ top: above, left: mascot.left - GAP - cardWidth }, { top: above, left: mascot.left + mascot.width + GAP });
    spots.push(
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
  if (mascots.length) {
    // No full-height spot: the tallest stretch that still keeps off the mascots, the control and the sidebar.
    const blocks = [...mascots, ...(target ? [target] : []), ...(side ? [side] : [])];
    const lefts = [...spots.map((spot) => spot.left), minLeft];
    for (let left = minLeft; left + cardWidth <= width - EDGE; left += 16) lefts.push(left);
    let best: { top: number; left: number; length: number } | null = null;
    for (const raw of lefts) {
      const left = Math.max(minLeft, Math.min(raw, width - cardWidth - EDGE));
      const rows = freeRows(left, left + cardWidth, blocks, height);
      if (!best || rows.length > best.length) best = { ...rows, left };
    }
    if (best && best.length >= MIN_SQUEEZED) return { top: best.top, left: best.left, maxWidth, maxHeight: Math.floor(best.length) };
  }
  return { top: EDGE, left: Math.min(minLeft, Math.max(EDGE, width - cardWidth - EDGE)), maxWidth };
}
