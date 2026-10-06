// The hover bar on a message (DESIGN-SPEC §4.2.6): it floats above the message on hover or keyboard focus and
// never takes space in the thread. Each action calls its row's engine method; an action the engine or this
// window can't do yet stays visible, greyed, with its reason as the tooltip (§5.1 "Disabled, with the reason").
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
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
  startConversation?: Act;
  /** Read aloud / Stop reading on a reply (§4.2.6). */
  read?: Act & { reading: boolean };
};

/** Reasons for the controls this engine has no method for (listed in the ledger's "Engine gaps"). */
export const NO_FLAG = "Not available in this engine yet: message flags (no engine method keeps a flag with a reply).";
export const NO_PIN = "Not available in this engine yet: pinned messages (no engine method pins one message).";
export const NO_LEAVE_OUT = "Not available in this engine yet: leaving one message out of context.";
export const NO_GOOD = "Not available in this engine yet: marking a good reply (no engine method keeps reply feedback).";
export const NO_BAD = "Not available in this engine yet: marking a bad reply (no engine method keeps reply feedback).";
export const NO_COMPARE = "Not available in this engine yet: asking a second model the same thing beside this reply.";
export const NO_PICTURE = "Not available in this window yet: drawing a message as a picture.";
export const NO_CODING_APP = "Carrying a conversation into a coding app on this computer needs the Branch app.";
export const NO_DELETE = "Not available in this engine yet: deleting one message (no engine method removes a transcript entry).";

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

function MoreMenu({ actions, isReply, onClose }: { actions: HoverActions; isReply: boolean; onClose: () => void }) {
  const item = (label: string, act: Act | null, reason?: string) => (
    <button type="button" className="mi" role="menuitem" disabled={Boolean(reason ?? act?.disabled)} title={shownWhy(reason ?? act?.disabled)}
      onClick={() => { act?.run(); onClose(); }}>
      {label}
    </button>
  );
  return (
    <Popover label="More" onClose={onClose}>
      <div className="pop-head">Reply tools</div>
      {!isReply ? item("Edit", actions.edit ?? null) : item("Try again", actions.retry ?? null)}
      {item("Branch from here", actions.branch)}
      {actions.startConversation ? item("Start a conversation from here", actions.startConversation) : null}
      {isReply ? item("Ask another model", null, NO_COMPARE) : null}
      <hr className="msep" />
      <div className="pop-head">Inspect</div>
      {isReply ? item("Every step behind this reply", actions.inspect ?? null) : null}
      {isReply && actions.read ? item(actions.read.reading ? "Stop reading" : "Read aloud", actions.read) : null}
      <hr className="msep" />
      <div className="pop-head">Context</div>
      {item("Leave out of context", null, NO_LEAVE_OUT)}
      <hr className="msep" />
      <div className="pop-head">Feedback</div>
      {isReply ? item("Good reply", null, NO_GOOD) : null}
      {isReply ? item("Bad reply", null, NO_BAD) : null}
      {isReply ? item("Flag", null, NO_FLAG) : null}
      <hr className="msep" />
      <div className="pop-head">Share</div>
      {item("As a picture", null, NO_PICTURE)}
      {item("To a coding app", null, NO_CODING_APP)}
      <hr className="msep" />
      {item("Delete", null, NO_DELETE)}
    </Popover>
  );
}

/** One visible toolbar for either sender; secondary actions live under More (§2.19). */
export function HoverBar({ isReply, actions, meta }: { isReply: boolean; actions: HoverActions; meta?: MessageMeta }) {
  const [menu, setMenu] = useState<"react" | "more" | null>(null);
  const time = meta?.timestamp ? messageTime(meta.timestamp) : "";
  const model = isReply ? modelName(meta?.model) : "";
  const close = () => setMenu(null);
  return (
    <div className={`hover-bar ${isReply ? "on-reply" : "on-user"}${menu ? " held" : ""}`} data-testid="hover-bar">
      <Btn label="Copy" d={ICONS.copy} act={actions.copy} />
      <Btn label="Reply" d={ICONS.reply} act={actions.reply} />
      <Btn label="React" d={ICONS.react} act={{ run: () => setMenu("react"), disabled: actions.reactDisabled }} />
      <Btn label="Pin" d={ICONS.pin} act={{ run: () => undefined, disabled: NO_PIN }} />
      <Btn label="More" d={ICONS.more} act={{ run: () => setMenu("more"), disabled: null }} />
      {time ? (
        <span className="hb-time" title={meta?.timestamp ? fullTime(meta.timestamp) : undefined} aria-label={model ? `Sent at ${time} by ${model}` : `Sent at ${time}`}>
          {model ? `${time} · ${model}` : time}
        </span>
      ) : null}
      {menu === "react" ? <ReactMenu onClose={close} onPick={(e) => { actions.react(e); close(); }} /> : null}
      {menu === "more" ? <MoreMenu actions={actions} isReply={isReply} onClose={close} /> : null}
    </div>
  );
}
