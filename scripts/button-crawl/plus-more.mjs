// The + popover's More… row switches the same popover to another view. The crawl's single overlay level never opens it,
// so the crawl queues that view as its own screen (keys read "<popover> > More… :: <control>").
export const PLUS_POPOVER = 'Attach, mention a Trunk, skills, Temporary';
export const PLUS_MORE_ROW = 'More…';

/** True for the More… row of the + popover, clicked from that popover's own overlay screen. */
export function isPlusMoreRow(el, screen) {
  return el.name === PLUS_MORE_ROW && screen.depth === 1 && screen.path?.at(-1)?.name === PLUS_POPOVER;
}
