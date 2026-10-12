// The message hover bar (owner item 40, HANDOFF §2 #17): exactly three buttons, React, Reply and •••, in control
// glass. ••• opens the message menu: its time and model, then Copy ›, Pin, Edit or Try again, Read aloud, Branch from
// here, Leave out of context, Share as a picture, Continue in a coding app, Look inside and Delete. Each row runs its
// engine call (thread/useMessageActions) through <Coming need=…>, or shows Coming with its reason; nothing pretends.
// Only Copy, its submenu and Look inside are local (data-local): they make no engine call.
import { useRef, useState, type ReactNode } from "react";
import { Coming } from "../../glass/coming";
import { Popover } from "../../glass/Popover";
import { Icon, type IconName } from "../../shell/icons";
import { copyText, useThread } from "../../thread/context";
import { fullTime, messageTime, modelName } from "../../thread/format";
import type { Act, HoverActions } from "../../thread/HoverBar";
import { Icon as PathIcon, ICONS } from "../../thread/icons";
import type { MessageMeta } from "../../thread/model";
import { plainText } from "./chat-logic";

const QUICK = ["👍", "❤️", "🎉", "👀", "🚀", "😂"];

/** Rows the engine has no call for yet. Each names the call it waits for and says so in one plain line. */
const SOON = {
  link: { need: "sessions.messages.link", reason: "Links to one message come in a later update." },
  pin: { need: "sessions.messages.pin", reason: "Pinning a message comes in a later update." },
  picture: { need: "sessions.messages.share", reason: "Sharing a message as a picture comes in a later update." },
  coding: { need: "sessions.handoff", reason: "Carrying a conversation into a coding app on this computer needs the Branch app." },
  remove: { need: "sessions.messages.delete", reason: "Deleting one message comes in a later update." },
} as const;

type Need = { need: string | readonly string[]; reason: string };

/** Rows that work today, with the engine calls they make (thread/actions.ts, thread/useMessageActions.tsx,
 *  thread/read-aloud.ts). On an engine without one of these calls the row turns Coming with its reason. */
const NEEDS = {
  again: { need: ["sessions.rewind", "chat.send"], reason: "This engine can’t go back in a conversation to try again." },
  edit: { need: ["sessions.rewind", "chat.send"], reason: "This engine can’t go back in a conversation to edit a message." },
  read: { need: "talk.speak", reason: "This engine has no voice to read replies aloud." },
  branch: { need: "sessions.fork", reason: "This engine can’t branch a conversation." },
  context: { need: "session.context.set", reason: "This engine can’t leave a message out of context." },
} as const satisfies Record<string, Need>;

/** One reason for Reply: it only sends, so without chat.send nothing can be sent at all. */
const REPLY_NEED: Need = { need: "chat.send", reason: "This engine can’t send messages." };

/** A row that runs now. With "need" it calls the engine and goes through Coming; without it the row is local
 *  (Copy, Look inside) and says so with data-local. */
function Row({ icon, label, act, onDone, danger, hint, need }: { icon: IconName; label: string; act?: Act | null; onDone: () => void; danger?: boolean; hint?: ReactNode; need?: Need }) {
  if (!act) return null;
  const why = act.disabled ? (act.waiting ? "Available when the agent finishes." : act.disabled) : null;
  const row = <button type="button" role="menuitem" className="r1c-mi" data-danger={danger || undefined} data-local={need ? undefined : ""} aria-disabled={why ? "true" : undefined} title={why ?? undefined}
    onClick={() => { if (why) return; act.run(); onDone(); }}>
    <Icon name={icon} size={15} /><span className="r1c-mi-t">{label}</span>{hint ? <span className="r1c-mi-hint">{hint}</span> : null}
  </button>;
  return need ? <Coming need={need.need} reason={need.reason} where={label}>{row}</Coming> : row;
}

function SoonRow({ icon, label, soon, danger }: { icon: IconName; label: string; soon: { need: string; reason: string }; danger?: boolean }) {
  return <Coming need={soon.need} reason={soon.reason} where={label}>
    <button type="button" role="menuitem" className="r1c-mi" data-danger={danger || undefined} aria-disabled="true" title={soon.reason}>
      <Icon name={icon} size={15} /><span className="r1c-mi-t">{label}</span>
    </button>
  </Coming>;
}

export function MessageMenu({ text, isReply, actions, meta, onClose }: { text: string; isReply: boolean; actions: HoverActions; meta?: MessageMeta; onClose: () => void }) {
  const { toast } = useThread();
  const [copyOpen, setCopyOpen] = useState(false);
  const at = meta?.timestamp;
  const model = isReply ? modelName(meta?.model) : "";
  const head = [at ? messageTime(at) : "", model].filter(Boolean).join(" · ");
  if (copyOpen) {
    return <div className="r1c-menu" role="menu" aria-label="Copy">
      <button type="button" role="menuitem" className="r1c-mi r1c-back" data-local="" onClick={() => setCopyOpen(false)}><Icon name="back" size={15} /><span className="r1c-mi-t">Copy</span></button>
      <button type="button" role="menuitem" className="r1c-mi" data-local="" onClick={() => { void copyText(plainText(text), toast); onClose(); }}><Icon name="copy" size={15} /><span className="r1c-mi-t">Text</span></button>
      <button type="button" role="menuitem" className="r1c-mi" data-local="" onClick={() => { void copyText(text, toast); onClose(); }}><Icon name="code" size={15} /><span className="r1c-mi-t">Markdown</span></button>
      <SoonRow icon="link" label="Link" soon={SOON.link} />
    </div>;
  }
  const read = actions.read;
  return <div className="r1c-menu" role="menu" aria-label="Message">
    {head ? <div className="r1c-menu-meta" title={at ? fullTime(at) : undefined}>{head}</div> : null}
    <button type="button" role="menuitem" className="r1c-mi" data-local="" aria-haspopup="menu" onClick={() => setCopyOpen(true)}><Icon name="copy" size={15} /><span className="r1c-mi-t">Copy</span><span className="r1c-mi-hint" aria-hidden="true">›</span></button>
    <SoonRow icon="pin" label="Pin" soon={SOON.pin} />
    <div className="r1c-gap" />
    {isReply ? <Row icon="retry" label="Try again" act={actions.retry} onDone={onClose} need={NEEDS.again} /> : <Row icon="edit" label="Edit" act={actions.edit} onDone={onClose} need={NEEDS.edit} />}
    {read ? <Row icon={read.reading ? "pause" : "play"} label={read.reading ? "Stop reading" : "Read aloud"} act={read} onDone={onClose} need={NEEDS.read} /> : null}
    <Row icon="branch" label="Branch from here" act={actions.branch} onDone={onClose} need={NEEDS.branch} />
    {actions.context ? <Row icon={actions.context.excluded ? "eye" : "eyeOff"} label={actions.context.excluded ? "Put back in context" : "Leave out of context"} act={actions.context} onDone={onClose} need={NEEDS.context} /> : null}
    <SoonRow icon="camera" label="Share as a picture" soon={SOON.picture} />
    <SoonRow icon="code" label="Continue in a coding app" soon={SOON.coding} />
    <Row icon="eye" label="Look inside" act={actions.inspect} onDone={onClose} />
    <div className="r1c-gap" />
    <SoonRow icon="trash" label="Delete" soon={SOON.remove} danger />
  </div>;
}

function ReactMenu({ onPick }: { onPick: (emoji: string) => void }) {
  return <div className="r1c-react" role="menu" aria-label="Quick reactions">
    {QUICK.map((emoji) => <Coming key={emoji} need="session.reactions.set" reason="Reactions come in a later update.">
      <button type="button" role="menuitem" aria-label={"React " + emoji} onClick={() => onPick(emoji)}>{emoji}</button>
    </Coming>)}
  </div>;
}

/** The three buttons; "replyLabel" is "Reply in <topic>" inside topics. */
export function HoverBar({ text, isReply, actions, meta, replyLabel = "Reply" }: { text: string; isReply: boolean; actions: HoverActions; meta?: MessageMeta; replyLabel?: string }) {
  const [menu, setMenu] = useState<"react" | "more" | null>(null);
  const react = useRef<HTMLButtonElement>(null), more = useRef<HTMLButtonElement>(null);
  const close = () => setMenu(null);
  const reply = actions.reply;
  return <div className="r1c-bar g-ctl" data-held={menu ? "" : undefined} data-testid="hover-bar" role="toolbar" aria-label="Message actions">
    <Coming need="session.reactions.set" reason="Reactions come in a later update.">
      <button ref={react} type="button" aria-label="React" title={actions.reactDisabled ?? "React"} aria-disabled={actions.reactDisabled ? "true" : undefined} aria-haspopup="menu" aria-expanded={menu === "react"}
        onClick={() => { if (!actions.reactDisabled) setMenu((m) => (m === "react" ? null : "react")); }}><PathIcon d={ICONS.react} size={15} /></button>
    </Coming>
    <Coming need={REPLY_NEED.need} reason={REPLY_NEED.reason}>
      <button type="button" aria-label={replyLabel} title={reply.disabled ?? replyLabel} aria-disabled={reply.disabled ? "true" : undefined} onClick={() => { if (!reply.disabled) reply.run(); }}><PathIcon d={ICONS.reply} size={15} /></button>
    </Coming>
    <button ref={more} type="button" aria-label="More for this message" title="More" data-local="" aria-haspopup="menu" aria-expanded={menu === "more"} onClick={() => setMenu((m) => (m === "more" ? null : "more"))}><Icon name="more" size={15} /></button>
    {menu === "react" ? <Popover anchor={react} label="Quick reactions" onClose={close} width={260} align={isReply ? "end" : "start"}><ReactMenu onPick={(emoji) => { actions.react(emoji); close(); }} /></Popover> : null}
    {menu === "more" ? <Popover anchor={more} label="Message" onClose={close} width={260} align={isReply ? "end" : "start"}><MessageMenu text={text} isReply={isReply} actions={actions} meta={meta} onClose={close} /></Popover> : null}
  </div>;
}
