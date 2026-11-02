/** spec-v23 T13-noscroll: a column fades over the last 18px when more sits below. */
export const LIST_FADE = 18;
/** spec-v23 pane-tabs / chip row: the last 24px fade when the row overflows. */
export const CHIP_FADE = 24;

const SLACK = 1;

/** Whether a scroller has more past each edge. Slack covers sub-pixel layout. */
export function scrollOverflow(
  content: number,
  viewport: number,
  offset: number,
  slack = SLACK,
): { overflow: boolean; moreStart: boolean; moreEnd: boolean } {
  const overflow = content > viewport + slack;
  return {
    overflow,
    moreStart: overflow && offset > slack,
    moreEnd: overflow && content - viewport - offset > slack,
  };
}
