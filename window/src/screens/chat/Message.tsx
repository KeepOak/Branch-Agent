// Bubbles (HANDOFF §2 #16): your message is a bubble on the right (radius 20/20/6/20, --fill-2, 14.5 px); an agent's
// reply has no box, its 28 px face in the gutter on the first message of a turn. A streaming reply arrives word by
// word, each new word fading in from a 2 px blur; when it finishes the Markdown takes over.
import { memo, useState, type ReactNode } from "react";
import { Attachments } from "../../thread/Attachments";
import { fullTime, messageTime, modelName } from "../../thread/format";
import { Markdown } from "../../thread/markdown";
import type { Block } from "../../thread/model";
import { withMentions } from "../../rooms/RoomMessage";
import { streamTokens } from "./chat-logic";

type User = Extract<Block, { kind: "user" }>;
type Text = Extract<Block, { kind: "text" }>;

/** Over 1,200 characters or 40 lines, your message folds to its first lines with "Show more". */
const isLong = (text: string) => text.length > 1200 || text.split("\n").length > 40;

/** One word of a streaming reply. Memoised by position, so a word already on screen never re-animates. */
const Token = memo(function Token({ text }: { text: string }) {
  return text.startsWith("\n") ? <br /> : <span className="r1c-tok">{text}</span>;
});

export function StreamText({ text }: { text: string }) {
  return <div className="r1c-stream" data-testid="streaming">{streamTokens(text).map((t, i) => <Token key={i} text={t} />)}</div>;
}

export function TimeLine({ at, model, mine, mode }: { at?: number; model?: string; mine: boolean; mode: "hover" | "always" | "never" }) {
  if (!at || mode === "never") return null;
  const name = model ? modelName(model) : "";
  return <div className="r1c-when" data-mine={mine || undefined} data-show={mode} title={fullTime(at)}>{name ? messageTime(at) + " · " + name : messageTime(at)}</div>;
}

export function UserBubble({ block, bar, after }: { block: User; bar?: ReactNode; after?: ReactNode }) {
  const long = isLong(block.text);
  const [open, setOpen] = useState(false);
  return <div className="r1c-row r1c-me" data-entry={block.meta?.entryId} data-out={block.meta?.excluded || undefined}>
    <div className="r1c-u" data-folded={long && !open ? "" : undefined} data-testid="message" data-role="user">
      {bar}
      {block.attachments?.length ? <Attachments items={block.attachments} mine /> : null}
      {withMentions(block.text)}
    </div>
    {long ? <button type="button" className="r1c-link r1c-more" data-local="" onClick={() => setOpen((v) => !v)}>{open ? "Show less" : "Show more"}</button> : null}
    {after}
  </div>;
}

/** "grow": a reply that just finished streaming unrolls once (clip-path), so the switch to Markdown never jumps. */
export function AgentReply({ block, face, working, from, bar, after, grow }: { block: Text; face?: ReactNode; working?: boolean; from?: string; bar?: ReactNode; after?: ReactNode; grow?: boolean }) {
  return <div className="r1c-row r1c-b" data-entry={block.meta?.entryId} data-out={block.meta?.excluded || undefined}>
    <div className="r1c-gut" data-working={working || undefined}>{face}</div>
    <div className="r1c-body">
      {bar}
      {from ? <div className="r1c-from">{from}</div> : null}
      <div className={grow ? "r1c-txt r1c-grow" : "r1c-txt"} data-testid="message" data-role="assistant">
        {block.streaming ? <StreamText text={block.text} /> : block.text ? <Markdown text={block.text} /> : null}
      </div>
      {block.attachments?.length ? <Attachments items={block.attachments} /> : null}
      {after}
    </div>
  </div>;
}
