// Messages waiting for a turn (DESIGN-SPEC §4.3.7): shown in the conversation as soon as they are written, marked
// "Queued", then "Delivered" once a turn picks them up, until the history shows them in place. Two sources: the
// engine's waiting inputs (another Trunk, an outside agent, another window) and this window's own waiting line.
import { useEffect, useState } from "react";
import type { QueuedMessage } from "../connect/session";
import { loadLine, mark, onLineChange, remove, saveLine, type QueueItem } from "../composer/queue";
import { safeStorage } from "../composer/drafts";
import { RoomMessage } from "../rooms/RoomMessage";
import { otherSender, type ThreadRoom } from "../rooms/thread-room";
import { NotSent, UserMessage } from "./blocks";

const MARK: Record<QueuedMessage["state"], string> = { queued: "Queued", delivered: "Delivered" };

/** This window's own waiting line for the open conversation (kept by the composer), live as it changes. */
export function useOwnWaitingLine(sessionKey: string | null | undefined): QueueItem[] {
  const read = () => {
    try {
      return sessionKey ? loadLine(safeStorage(), sessionKey) : [];
    } catch {
      return [];
    }
  };
  const [line, setLine] = useState<QueueItem[]>(read);
  useEffect(() => {
    setLine(read());
    // This window's changes and another window's (the storage event), so a pop-out's record shows here too.
    return sessionKey ? onLineChange(sessionKey, () => setLine(read())) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  return line;
}

/** `part` draws only some of them: "delivered" ones belong to the turn that is running, so the thread draws them
 *  over it; "waiting" ones (still queued, and this window's own line) come after it. */
/** "Not sent" › Try again puts it back in the line (it goes when the Trunk is free); Discard takes it out. */
function changeLine(sessionKey: string | undefined, change: (line: QueueItem[]) => QueueItem[]): void {
  if (!sessionKey) return;
  try {
    saveLine(safeStorage(), sessionKey, change(loadLine(safeStorage(), sessionKey)));
  } catch {
    // The line can't be written; the composer reports it on its own next write.
  }
}

export function QueuedMessages({ queued, own, room, part, sessionKey }: { queued: readonly QueuedMessage[]; own: readonly QueueItem[]; room?: ThreadRoom; part?: "delivered" | "waiting"; sessionKey?: string }) {
  const shown = queued.filter((q) => !part || (part === "delivered") === (q.state === "delivered"));
  return (
    <>
      {shown.map(({ key, block, state }) => {
        const other = otherSender(block, room);
        return (
          <div key={key} className={`queued-msg ${state}`} data-testid="queued-message" data-state={state}>
            {other ? (
              <RoomMessage sender={other} text={block.text} attachments={block.attachments} where={other.kind === "agent" ? room?.whereRuns(other.id) : null} online={other.kind === "agent" && room?.isOnline?.(other.id) === true} />
            ) : (
              <UserMessage block={block} />
            )}
            <span className={other ? "queue-mark theirs" : "queue-mark mine"}>{MARK[state]}</span>
          </div>
        );
      })}
      {(part === "delivered" ? [] : own)
        .filter((item) => item.state !== "sending")
        .map((item) =>
          item.state === "failed" ? (
            <NotSent key={`own:${item.id}`} text={item.text} reason={item.error ?? ""}
              onRetry={() => changeLine(sessionKey, (line) => mark(line, item.id, "waiting"))}
              onDiscard={() => changeLine(sessionKey, (line) => remove(line, item.id))} />
          ) : item.state === "checking" ? (
            // Sent, but the connection went before the engine answered: checked against the conversation, then
            // settled (it shows in place), sent again under the same id, or Not sent.
            <div key={`own:${item.id}`} className="queued-msg queued" data-testid="queued-message" data-state="checking">
              <UserMessage block={{ kind: "user", key: `own:${item.id}`, text: item.text }} />
              <span className="queue-mark mine" title="The connection closed before Branch could confirm it. Branch checks and sends it once if it never arrived.">Not confirmed yet</span>
            </div>
          ) : (
            <div key={`own:${item.id}`} className="queued-msg queued" data-testid="queued-message" data-state="queued">
              <UserMessage block={{ kind: "user", key: `own:${item.id}`, text: item.text }} />
              <span className="queue-mark mine">{MARK.queued}</span>
            </div>
          ),
        )}
    </>
  );
}
