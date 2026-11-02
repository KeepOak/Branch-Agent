// Trunks talking to each other in the R1 conversation (preview item 23, HANDOFF "Agent exchanges"): each exchange that
// rooms/fold.ts folds is one quiet centred line, "N messages with [faces] A and B" ("[faces] K agents" for 3 or more).
// - A face opens that exchange as its own read-only view over the chat, that Trunk's messages marked.
// - The words open the preview's popover: each participant, then "Show all N messages".
// - The view: the "[face] A ⇄ [face] B" pill, each message with its sender's face, name and time, and a centred
//   "Close Chat" pill. Escape closes it too; focus goes back to what opened it. It has no composer.
// Every folded message stays in the page as a visually hidden transcript, so Find and screen readers still reach it.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Face } from "../../face/Face";
import { PRIORITY } from "../../face/cap";
import { Popover, useLayer } from "../../glass/Popover";
import { talkAgents, type TalkItem } from "../../rooms/fold";
import { lineText } from "../../rooms/RoomMessage";
import { dividerPositions } from "./chat-logic";
import { TimeDivider } from "./lines";

/** A participant: a Trunk's agent id, or null for this conversation's own Trunk. */
type Who = string | null;

export type ExchangeNames = { ownName: string; trunkName: (agentId: string) => string; timeOf: (key: string) => number | undefined };

export type OpenExchange = { talk: TalkItem; who?: Who; opener: HTMLElement | null };

const nameOf = (who: Who, names: ExchangeNames) => (who ? names.trunkName(who) : names.ownName);
const count = (n: number) => (n === 1 ? "1 message" : `${n} messages`);

/** "Scout and Ledger", or "3 agents" for three or more (the preview's words). */
export function exchangeNames(ids: readonly Who[], names: ExchangeNames): string {
  return ids.length >= 3 ? `${ids.length} agents` : ids.map((id) => nameOf(id, names)).join(" and ");
}

function Faces({ ids, names, size }: { ids: readonly Who[]; names: ExchangeNames; size: number }) {
  return <span className="r1x-faces">{ids.slice(0, 3).map((id) => <Face key={id ?? ""} size={size} label={nameOf(id, names)} priority={PRIORITY.row} />)}</span>;
}

export function ExchangeLine({ talk, names, onOpen }: { talk: TalkItem; names: ExchangeNames; onOpen: (open: OpenExchange) => void }) {
  const [menu, setMenu] = useState(false);
  const words = useRef<HTMLButtonElement>(null);
  const ids = talkAgents(talk), n = talk.lines.length;
  if (!n) return null;
  const close = () => setMenu(false);
  return <div className="r1x-line" data-testid="exchange-line">
    <span className="r1x-n">{count(n)} with</span>
    <span className="r1x-who">
      <span className="r1x-faces">{ids.slice(0, 3).map((id) => {
        const name = nameOf(id, names);
        return <button key={id ?? ""} type="button" className="r1x-face" data-local="" data-solid="" aria-label={`Open the messages with ${name}`} title={name}
          onClick={(e) => onOpen({ talk, who: id, opener: e.currentTarget })}><Face size={18} label={name} priority={PRIORITY.row} /></button>;
      })}</span>
      <button ref={words} type="button" className="r1x-names" data-local="" data-solid="" aria-haspopup="dialog" aria-expanded={menu} title="See who talked" onClick={() => setMenu((v) => !v)}>{exchangeNames(ids, names)}</button>
    </span>
    {menu ? <Popover anchor={words} label="Who talked" onClose={close} width={240} align="start">
      <div className="r1c-menu r1x-pop">
        <div className="r1c-menu-meta">{count(n)}</div>
        {ids.map((id) => <button key={id ?? ""} type="button" className="r1c-mi" data-local="" onClick={() => { close(); onOpen({ talk, who: id, opener: words.current }); }}>
          <Face size={22} label={nameOf(id, names)} priority={PRIORITY.row} /><span>{nameOf(id, names)}</span>
        </button>)}
        <div className="r1c-gap" />
        <button type="button" className="r1c-mi" data-local="" onClick={() => { close(); onOpen({ talk, opener: words.current }); }}>Show all {count(n)}</button>
      </div>
    </Popover> : null}
    <div className="r1x-transcript">{talk.lines.map((line) => <p key={line.key}><b>{nameOf(line.agentId, names)}</b> {line.text}</p>)}</div>
  </div>;
}

/** The exchange over the chat. It draws into the R1 conversation column when there is one, else in place. */
export function ExchangeView({ open, names, host, onClose }: { open: OpenExchange; names: ExchangeNames; host: HTMLElement | null; onClose: () => void }) {
  const { talk, who } = open;
  const ids = talkAgents(talk);
  const closeRef = useRef<HTMLButtonElement>(null);
  const latest = useRef(onClose);
  useLayoutEffect(() => { latest.current = onClose; }, [onClose]);
  const close = useCallback(() => latest.current(), []);
  useLayer(true, close);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const opener = open.opener;
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, [open.opener]);
  const times = talk.lines.map((line) => names.timeOf(line.key));
  const dividers = dividerPositions(times);
  const label = ids.map((id) => nameOf(id, names)).join(" and ");
  const head: ReactNode = ids.length === 2
    ? <><Face size={22} label={nameOf(ids[0]!, names)} priority={PRIORITY.row} /><b>{nameOf(ids[0]!, names)}</b><span className="r1x-arrow" aria-hidden="true">⇄</span><Face size={22} label={nameOf(ids[1]!, names)} priority={PRIORITY.row} /><b>{nameOf(ids[1]!, names)}</b></>
    : <><Faces ids={ids} names={names} size={22} /><b>{exchangeNames(ids, names)}</b></>;
  let last: Who | undefined;
  const view = <div className="r1x-view" role="dialog" aria-modal="true" aria-label={label} data-testid="exchange-view" onKeyDown={(e) => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),[tabindex='0']")];
    const first = items[0], end = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end?.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first?.focus(); }
  }}>
    <div className="r1x-head" data-testid="exchange-head">{head}</div>
    <div className="r1x-list" tabIndex={0} aria-label={`${count(talk.lines.length)} between ${label}`}>
      {talk.lines.map((line, i) => {
        const same = last === line.agentId; last = line.agentId;
        const name = nameOf(line.agentId, names);
        return <Fragment key={line.key}>
          {dividers.has(i) ? <TimeDivider at={times[i]!} /> : null}
          <div className="r1x-msg" data-me={(who !== undefined && who === line.agentId) || undefined} data-testid="exchange-message">
            {same && !dividers.has(i) ? <span className="r1x-gap" /> : <Face size={28} label={name} priority={PRIORITY.row} />}
            <div className="r1x-body">
              {same && !dividers.has(i) ? null : <b>{name}</b>}
              <p>{lineText(line.text)}</p>
            </div>
          </div>
        </Fragment>;
      })}
    </div>
    <button ref={closeRef} type="button" className="r1x-close" data-local="" onClick={close}>Close Chat</button>
  </div>;
  return host ? createPortal(view, host) : view;
}
