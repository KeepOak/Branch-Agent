// Live-Activity approvals (preview item 15 cAskP17 / cMoreP17 / v-ans; HANDOFF R1-05). When the conversation that asks
// isn't on screen, or during a call, the approval drops under the header (dropP17): "Ledger needs you · Send this email
// to Dana Okafor? · [Yes] [No]". After an answer it shows ✓ or ✕ for about a second, lifts away (liftP17) and the next
// one drops in. One is visible at a time, with a "+2" badge for the rest. At 390 it is full width under the header.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Coming } from "../../glass/coming";
import { LOCKDOWN_WHY } from "./AskCard";
import { RESOLVE_OF, type Reply } from "./model";
import type { AskState } from "./useAsks";

export const DONE_MS = 650, LIFT_MS = 300;

type DropProps = {
  waiting: AskState[];
  nameOf: (agentId?: string) => string;
  onAnswer: (id: string, reply: Reply) => void;
  /** Opens the conversation that asks; questions are answered there. */
  onOpen?: (sessionKey: string) => void;
  lockdown?: boolean;
};

export function AskDrop({ waiting, nameOf, onAnswer, onOpen, lockdown }: DropProps) {
  const [leaving, setLeaving] = useState<{ state: AskState; yes: boolean; away: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector(".r1-conversation") ?? document.body), []);
  const current = leaving?.state ?? waiting.find((s) => s.status === "waiting") ?? waiting[0];
  if (!current || !host) return null;
  const { ask } = current;
  const more = waiting.filter((s) => s.ask.id !== ask.id).length;
  const send = (reply: Reply, yes: boolean) => {
    onAnswer(ask.id, reply);
    setLeaving({ state: current, yes, away: false });
    timers.current.push(setTimeout(() => setLeaving((l) => (l ? { ...l, away: true } : l)), DONE_MS));
    timers.current.push(setTimeout(() => setLeaving(null), DONE_MS + LIFT_MS));
  };
  const open = ask.sessionKey && onOpen ? () => onOpen(ask.sessionKey!) : undefined;
  return createPortal(
    <div className="r1-drop-wrap" data-host={host === document.body ? "body" : "column"}>
      <div className="r1-drop g-float" key={ask.id} role="region" aria-label={`${nameOf(ask.agentId)} needs you`} data-testid="r1-drop" data-away={leaving?.away || undefined} data-done={leaving ? (leaving.yes ? "yes" : "no") : undefined}>
        <div className="r1-drop-top"><b>{nameOf(ask.agentId)} needs you</b>{more ? <span className="r1-drop-more" aria-label={`${more} more waiting`}>+{more}</span> : null}</div>
        <span className="r1-drop-q">{ask.title}</span>
        <div className="r1-drop-acts">
          {leaving ? <span className="r1-drop-done">{leaving.yes ? "✓ Done" : "✕ Declined"}</span> : ask.kind === "question" ? (
            open ? <button type="button" className="r1-ask-btn" data-kind="primary" data-local onClick={open}>Open</button> : null
          ) : (
            <>
              {ask.allowed.includes("allow-once") ? (
                <Coming need={RESOLVE_OF[ask.kind]}><button type="button" className="r1-ask-btn" data-kind="primary" disabled={lockdown || current.status !== "waiting"} title={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => send("allow-once", true)}>Yes</button></Coming>
              ) : null}
              <Coming need={RESOLVE_OF[ask.kind]}><button type="button" className="r1-ask-btn" disabled={current.status !== "waiting"} onClick={() => send("deny", false)}>No</button></Coming>
            </>
          )}
        </div>
        {current.error && !leaving ? <p className="r1-ask-error" role="alert">That didn’t go through: {current.error}</p> : null}
      </div>
    </div>,
    host,
  );
}
