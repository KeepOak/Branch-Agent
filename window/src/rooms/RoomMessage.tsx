// A message from someone other than you (DESIGN-SPEC §4.2.4): a person (their initial on their colour, a filled
// bubble) or an agent on another computer (its initial, a dashed bubble and the "A2A · <where it runs>" badge).
// Hooks for the scripts: data-testid="message" with data-role "person" or "agent".
import { Fragment, type ReactNode } from "react";
import { initials, personColour } from "../places/people/data";
import { Attachments } from "../thread/Attachments";
import type { Attachment } from "../thread/model";
import type { Sender } from "./sender";
import "./rooms.css";

/** A person's or outside agent's round initial, on a steady colour from their id. */
export function RoomAvatar({ id, name, size, src }: { id: string; name: string; size: number; src?: string }) {
  const style = { ["--c" as string]: personColour(id), width: size, height: size, fontSize: Math.round(size * 0.38) };
  return (
    <span className="rm-av" style={style} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(name)}
    </span>
  );
}

/** "@Name" at the start or after a space reads as a mention (`--accent-ink`, weight 500); an address keeps its "@". */
export function withMentions(text: string): ReactNode {
  const parts = text.split(/((?<=^|\s)@[\p{L}\p{N}_-]+)/u);
  return parts.map((part, i) => (i % 2 === 1 ? <span key={i} className="rm-mention">{part}</span> : <Fragment key={i}>{part}</Fragment>));
}

/** A short line in a fold: mentions, **bold** and `code` as the reply would show them, the rest as written. */
export function lineText(text: string): ReactNode {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((part, i) =>
    i % 2 === 0 ? <Fragment key={i}>{withMentions(part)}</Fragment> : part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <code key={i}>{part.slice(1, -1)}</code>,
  );
}

/** "A2A · <where it runs>", or just "A2A" when the engine has no address for it. */
export function a2aBadge(where: string | null): string {
  return where ? `A2A · ${where}` : "A2A";
}

type Props = {
  sender: Extract<Sender, { kind: "person" | "agent" }>;
  text: string;
  attachments?: Attachment[];
  where?: string | null;
  entryId?: string;
  children?: ReactNode;
};

export function RoomMessage({ sender, text, attachments, where = null, entryId, children }: Props) {
  const agent = sender.kind === "agent";
  return (
    <div className={agent ? "msg rm-msg rm-ext" : "msg rm-msg"} data-entry={entryId}>
      {children}
      <RoomAvatar id={sender.id} name={sender.name} size={32} src={sender.kind === "person" ? sender.avatarUrl : undefined} />
      <div className="rm-bubble" data-testid="message" data-role={agent ? "agent" : "person"}>
        <b>
          {sender.name}
          {agent ? <span className="rm-tag">{a2aBadge(where)}</span> : null}
        </b>
        {attachments?.length ? <Attachments items={attachments} /> : null}
        {text ? <p>{withMentions(text)}</p> : null}
      </div>
    </div>
  );
}
