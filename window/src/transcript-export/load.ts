// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/utils/transcript-export/load-complete-events.ts (atlas SESSIONS-0047). Adapted to chat.history offset pagination.
import type { WindowEngine } from "../connect/engine";
import { historyToBlocks } from "../thread/history";
import type { Block } from "../thread/model";

export const TRANSCRIPT_HISTORY_PAGE_SIZE = 100;
type HistoryPage = {
  messages: unknown[];
  sessionId?: string;
  offset?: number;
  hasMore?: boolean;
  nextOffset?: number;
  totalMessages?: number;
  completeSnapshot?: boolean;
  omission?: { omittedCount: number };
};

/** A full persisted transcript, never a silently truncated visible tail. */
export async function loadCompleteTranscript(engine: WindowEngine, sessionKey: string, signal: AbortSignal): Promise<Block[]> {
  const pages: unknown[][] = [];
  const seenOffsets = new Set<number>();
  let offset = 0;
  let sessionId: string | undefined;
  let total: number | undefined;
  while (true) {
    signal.throwIfAborted();
    const page = await engine.request<HistoryPage>("chat.history", { sessionKey, offset, limit: TRANSCRIPT_HISTORY_PAGE_SIZE });
    signal.throwIfAborted();
    if (!page || !Array.isArray(page.messages)) throw new Error("Invalid transcript history response.");
    if (page.messages.some(message => (message as { __branch?: { truncated?: boolean } } | null)?.__branch?.truncated) || page.omission?.omittedCount) throw new Error("The engine omitted transcript entries; export would be incomplete.");
    if (sessionId && page.sessionId !== sessionId) throw new Error("The conversation changed while exporting. Please try again.");
    sessionId = page.sessionId;
    if (total !== undefined && page.totalMessages !== total) throw new Error("The conversation changed while exporting. Please try again.");
    total = page.totalMessages;
    pages.push(page.messages);
    if (page.hasMore === false || page.completeSnapshot === true) break;
    if (page.hasMore !== true) {
      if (total !== undefined && offset + page.messages.length >= total) break;
      throw new Error("Transcript history cannot prove that all messages were loaded.");
    }
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset! <= offset || seenOffsets.has(page.nextOffset!)) {
      throw new Error("Transcript history pagination did not advance.");
    }
    seenOffsets.add(offset);
    offset = page.nextOffset!;
  }
  // Gateway pages walk backwards from the tail, each page in chronological order.
  const messages = pages.reverse().flat();
  const ids = new Set<string>();
  const unique = messages.filter(message => {
    const id = (message as { __branch?: { id?: string } } | null)?.__branch?.id;
    if (!id) return true;
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  return historyToBlocks(unique, [], sessionKey, null);
}
