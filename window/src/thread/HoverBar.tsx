// The hover bar on a message (DESIGN-SPEC §4.2.6): it floats above the message on hover or keyboard focus and
// never takes space in the thread. Each action calls its row's engine method; an action the engine or this
// window can't do yet stays visible, greyed, with its reason as the tooltip (§5.1 "Disabled, with the reason").
import { useRef, useState } from "react";
import { Popover } from "./Dialog";
import { fullTime, messageTime, modelName } from "./format";
import { Icon, ICONS } from "./icons";
import type { MessageMeta } from "./model";
import { shownWhy } from "../shell/shown-why";

/** An action and why it can't run now (null when it can). */
export type Act = { run: () => void; disabled: string | null };

export type HoverActions = {
  copy: Act;
  retry?: Act;
  edit?: Act;
  reply: Act;
  react: (emoji: string, remove?: boolean) => void;
  reactDisabled: string | null;
  inspect?: Act;
  branch: Act;
  context?: Act & { excluded: boolean };
  startConversation?: Act;
  /** Read aloud / Stop reading on a reply (§4.2.6). */
  read?: Act & { reading: boolean };
};

/** Why "Leave out of context" is off when this message has no engine id. */
export const NO_LEAVE_OUT = "You can't leave a message out of context here yet.";

const QUICK = ["👍", "❤️", "🎉", "👀", "🚀", "😂"];

// One emoji grapheme: the engine's own admission rule (engine/packages/gateway-protocol/src/schema/sessions-reactions.ts).
const emojiSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const emojiSequence =
  /^(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F}|\p{Extended_Pictographic}️?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}️?\p{Emoji_Modifier}?)*)$/u;
export function isReactionEmoji(emoji: string): boolean {
  return Array.from(emoji).length <= 32 && [...emojiSegmenter.segment(emoji)].length === 1 && emojiSequence.test(emoji);
}

function Btn({ label, d, act, pressed }: { label: string; d: string; act?: Act | null; pressed?: boolean }) {
  const reason = act ? act.disabled : null;
  return (
    <button
      type="button"
      className="hb-btn"
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={!act || Boolean(reason)}
      title={shownWhy(reason) ?? label}
      disabled={!act || Boolean(reason)}
      data-act={label}
      onClick={act && !reason ? act.run : undefined}
    >
      <Icon d={d} />
    </button>
  );
}

function ReactMenu({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [more, setMore] = useState(false);
  const [value, setValue] = useState("");
  const bad = value.trim() !== "" && !isReactionEmoji(value.trim());
  return (
    <Popover label="Quick reactions" onClose={onClose}>
      <div className="pop-head">Quick reactions</div>
      <div className="emoji-row">
        {QUICK.map((e) => (
          <button key={e} type="button" className="emoji" aria-label={e} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
        <button type="button" className="mi-inline" onClick={() => setMore(true)}>
          More…
        </button>
      </div>
      {more ? (
        <form className="emoji-more" onSubmit={(ev) => { ev.preventDefault(); if (!bad && value.trim()) onPick(value.trim()); }}>
          <input aria-label="Any emoji" placeholder="Type or paste an emoji." value={value} onChange={(e) => setValue(e.target.value)} />
          {bad ? <small className="field-error">A reaction is one emoji.</small> : null}
        </form>
      ) : null}
    </Popover>
  );
}

function MoreMenu({ actions, isReply, onClose, anchor }: { actions: HoverActions; isReply: boolean; onClose: () => void; anchor: HTMLElement | null }) {
  const item = (label: string, act: Act | null, reason?: string) => (
    <button type="button" className="mi" role="menuitem" aria-disabled={Boolean(reason ?? act?.disabled)} title={reason ?? act?.disabled ?? undefined}
      onClick={() => { if (reason ?? act?.disabled) return; act?.run(); onClose(); }}>
      {label}
    </button>
  );
  return (
    <Popover label="More" onClose={onClose} anchor={anchor}>
      <div className="pop-head">Reply tools</div>
      {!isReply ? item("Edit", actions.edit ?? null) : item("Try again", actions.retry ?? null)}
      {item("Branch from here", actions.branch)}
      {actions.startConversation ? item("Start a conversation from here", actions.startConversation) : null}
      {/* Inspect and Feedback hold only reply actions: on your own message the groups go, not just their items. */}
      {isReply ? (
        <>
          <hr className="msep" />
          <div className="pop-head">Inspect</div>
          {item("Every step behind this reply", actions.inspect ?? null)}
          {actions.read ? item(actions.read.reading ? "Stop reading" : "Read aloud", actions.read) : null}
        </>
      ) : null}
      <hr className="msep" />
      <div className="pop-head">Context</div>
      {item(actions.context?.excluded ? "Put back in context" : "Leave out of context", actions.context ?? null, actions.context ? undefined : NO_LEAVE_OUT)}
    </Popover>
  );
}

/** One visible toolbar for either sender; secondary actions live under More (§2.19). */
export function HoverBar({ isReply, actions, meta }: { isReply: boolean; actions: HoverActions; meta?: MessageMeta }) {
  const [menu, setMenu] = useState<"react" | "more" | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const time = meta?.timestamp ? messageTime(meta.timestamp) : "";
  const model = isReply ? modelName(meta?.model) : "";
  const close = () => setMenu(null);
  return (
    <div ref={bar} className={`hover-bar ${isReply ? "on-reply" : "on-user"}${menu ? " held" : ""}`} data-testid="hover-bar">
      <Btn label="Copy" d={ICONS.copy} act={actions.copy} />
      <Btn label="Reply" d={ICONS.reply} act={actions.reply} />
      <Btn label="React" d={ICONS.react} act={{ run: () => setMenu("react"), disabled: actions.reactDisabled }} />
      <Btn label="More" d={ICONS.more} act={{ run: () => setMenu("more"), disabled: null }} />
      {time ? (
        <span className="hb-time" title={meta?.timestamp ? fullTime(meta.timestamp) : undefined} aria-label={model ? `Sent at ${time} by ${model}` : `Sent at ${time}`}>
          {model ? `${time} · ${model}` : time}
        </span>
      ) : null}
      {menu === "react" ? <ReactMenu onClose={close} onPick={(e) => { actions.react(e); close(); }} /> : null}
      {menu === "more" ? <MoreMenu actions={actions} isReply={isReply} onClose={close} anchor={bar.current} /> : null}
    </div>
  );
}
