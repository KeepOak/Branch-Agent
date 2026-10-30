// Edit is offered on your own latest message (preview edit on a user message, limited to the last one you sent).
import { isMine } from "../rooms/sender";
import type { Block } from "./model";

/** Index of the viewer's latest own message, or -1. `selfId` null means nobody is signed in; undefined means it is still loading. */
export function ownLastMessageIndex(blocks: readonly Block[], selfId: string | null | undefined): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (!block || block.kind !== "user") continue;
    if (isMine(block.meta?.sender, block.meta?.owner === true, selfId)) return i;
  }
  return -1;
}
