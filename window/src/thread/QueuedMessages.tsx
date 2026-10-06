// Messages waiting for a turn (DESIGN-SPEC §4.3.7): shown in the conversation as soon as they are written, marked
// "Queued", then "Delivered" once a turn picks them up, until the history shows them in place. Two sources: the
// engine's waiting inputs (another Trunk, an outside agent, another window) and this window's own waiting line.
import { useEffect, useState } from "react";
import type { QueuedMessage } from "../connect/session";
import { loadLine, WAITING_LINE_EVENT, type QueueItem } from "../composer/queue";
import { safeStorage } from "../composer/drafts";
import { RoomMessage } from "../rooms/RoomMessage";
import { otherSender, type ThreadRoom } from "../rooms/thread-room";
import { UserMessage } from "./blocks";

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
    const onChange = (event: Event) => {
      if ((event as CustomEvent<{ sessionKey?: string }>).detail?.sessionKey === sessionKey) setLine(read());
    };
    window.addEventListener(WAITING_LINE_EVENT, onChange);
    return () => window.removeEventListener(WAITING_LINE_EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  return line;
}

export function QueuedMessages({ queued, own, room }: { queued: readonly QueuedMessage[]; own: readonly QueueItem[]; room?: ThreadRoom }) {
  return (
    <>
      {queued.map(({ key, block, state }) => {
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
      {own
        .filter((item) => item.state !== "sending")
        .map((item) => (
          <div key={`own:${item.id}`} className="queued-msg queued" data-testid="queued-message" data-state="queued">
            <UserMessage block={{ kind: "user", key: `own:${item.id}`, text: item.text }} />
            <span className="queue-mark mine">{item.state === "failed" ? "Not sent" : MARK.queued}</span>
          </div>
        ))}
    </>
  );
}
