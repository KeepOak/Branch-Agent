import type { MouseEvent, ReactNode } from "react";
import type { Conversation, RunMark } from "../connect/conversations";
import { Pebble } from "../face/Pebble";
import { RoomFaces } from "../rooms/RoomFaces";
import { Icon, type IconName } from "./icons";
import { colourHue, RowIcon } from "./row-look";
import "./rows.css";

export type RowState = { waiting: boolean; working: boolean };

/** What the row's marks need besides the engine row (§4.1.1.1 Parity adds, the preview's badgesPA18). */
export type RowExtras = {
  /** An unsent draft is kept for it (not shown on the open conversation). */
  draft: boolean;
  /** Messages waiting to send in it. */
  waitingToSend: number;
  /** Advanced or Technical: the repository, computer, automation and copied-from badges show. */
  advanced: boolean;
  /** Appearance: "Headlines for working conversations" and "What a working Trunk is doing, in the list". */
  headlines: boolean;
  liveInList: boolean;
  /** Names a conversation key (for "Copied from <name>"). */
  nameOf: (key: string) => string;
};

type Props = {
  row: Conversation;
  /** The computer the agent is on (a grafted agent's contact `where`), so its avatar matches its same-named peers. */
  where?: string;
  current: boolean;
  time: string;
  showPreview: boolean;
  popped?: boolean;
  state: RowState;
  trunkName: string;
  dimmed?: boolean;
  wakes?: string;
  extras?: RowExtras;
  /** Its child conversations: how many, and whether they show (§4.1.1.1 child conversations). */
  kids?: { count: number; open: boolean; onToggle: () => void };
  /** Indent under a parent or a project (16 px a step). */
  depth?: number;
  child?: boolean;
  selected?: boolean;
  pinDraggable?: boolean;
  pinFixed?: boolean;
  fallbackLine?: string;
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  onMenu: (event: MouseEvent<HTMLElement>) => void;
  onPin?: () => void;
  onArchive?: () => void;
  /** The conversation card on hover or keyboard focus (§4.1.1.1). */
  onCard?: (el: HTMLElement | null) => void;
};

const MARKS: Record<RunMark, { icon: IconName; word: string; bad: boolean }> = {
  queued: { icon: "clock", word: "Queued", bad: false },
  failed: { icon: "alert", word: "Failed", bad: true },
  timeout: { icon: "alert", word: "Timed out", bad: true },
  stopped: { icon: "alert", word: "Stopped", bad: true },
};

/** The small marks after the name, each with its words (the preview's order). */
export function badgeList(row: Conversation, x: RowExtras | undefined): { icon: IconName; words: string }[] {
  if (!x) return [];
  const out: { icon: IconName; words: string }[] = [];
  if (row.archived) out.push({ icon: "box", words: "Archived" });
  if (x.draft) out.push({ icon: "edit", words: "Unsent draft" });
  if (x.advanced) {
    if (row.execNode) out.push({ icon: "monitor", words: `Runs on ${row.execNode}` });
    if (row.repoBranch) out.push({ icon: "branch", words: row.repoBranch });
    if (row.automation) out.push({ icon: "clock", words: "Automation attached" });
    if (row.forkOf) out.push({ icon: "copy", words: `Copied from ${x.nameOf(row.forkOf)}` });
  }
  return out;
}

type Line = { text: string; word: string; tone: string; typing?: boolean };

/** Preview typingRowsT5: dots and "typing…" while a reply is written (no live headline yet). */
function replyTyping(row: Conversation, x: RowExtras | undefined): boolean {
  if (x?.liveInList !== false && x?.headlines !== false) return !row.headline;
  return row.preview.trim() === "…" || row.preview.trim() === "";
}

const TYPING_LINE: Line = { text: "typing…", word: "", tone: "", typing: true };

/** A working row's second line: what it is doing now, unless the owner turned headlines or live activity in the list off. */
function workingText(row: Conversation, x: RowExtras | undefined): string {
  if (x?.liveInList !== false && x?.headlines !== false) return row.headline || "Thinking";
  return row.preview.trim() === "…" ? "Thinking" : row.preview;
}

function workingLine(row: Conversation, x: RowExtras | undefined): Line {
  return replyTyping(row, x) ? TYPING_LINE : { text: workingText(row, x), word: "", tone: "" };
}

/** The second line (§4.1.1.1): while a reply is written, typingRowsT5; else its headline; failed shows why. */
function secondLine(row: Conversation, state: RowState, x: RowExtras | undefined): Line | null {
  if (["trunk", "chatGroup", "outside"].includes(row.kind)) {
    if (state.waiting) return { text: "Waiting on you", word: "", tone: "attn" };
    if (state.working) return workingLine(row, x);
    return null;
  }
  const mark = row.runMark ? MARKS[row.runMark] : null;
  if (state.waiting) return { text: "Waiting on you", word: "", tone: "attn" };
  if (mark?.bad) return { text: row.preview, word: mark.word, tone: "bad" };
  if (state.working) return workingLine(row, x);
  return null;
}

function RightColumn({ row, p, mark }: { row: Conversation; p: Props; mark: (typeof MARKS)[RunMark] | null }) {
  const why = mark ? (mark.bad ? `${mark.word}: ${row.runError || "it stopped"}` : `${mark.word}: waiting for a free slot`) : "";
  return (
    <span className="rc">
      {p.popped ? <span title="In its own window" aria-label="In its own window"><Icon name="panel" size={15} /></span> : null}
      <time className="row-time">{p.wakes ? `Wakes ${p.wakes}` : p.time}</time>
      {p.extras && p.extras.waitingToSend > 0 ? (
        <span className="cnts" title={`${p.extras.waitingToSend} messages waiting to send`} aria-label={`${p.extras.waitingToSend} messages waiting to send`}>{p.extras.waitingToSend}</span>
      ) : null}
      {p.kids && p.kids.count > 0 ? <span className="cnts kids" aria-label={`${p.kids.count} child conversations`}>{p.kids.count}</span> : null}
      {mark ? (
        <span className={mark.bad ? "mk bad" : "mk"} title={why} role="img" aria-label={mark.word} data-testid="row-mark">
          <Icon name={mark.icon} size={14} />
        </span>
      ) : row.unread && !p.current ? (
        <i className="unread" aria-label="Unread" />
      ) : null}
    </span>
  );
}

/** One conversation row (DESIGN-SPEC §4.1.1.1): face, icon and name with its marks, the right column (time, counts,
 *  run mark or unread dot) and a second line when previews are on or it waits, failed or works; hover buttons. */
export function ConversationRow(p: Props) {
  const { row, current, state } = p;
  const name = row.title || "New conversation";
  const mark = row.runMark ? MARKS[row.runMark] : null;
  const line = secondLine(row, state, p.extras);
  // One line unless previews are on, or it waits for you or failed (the preview's rowPA18).
  const twoLine = ["trunk", "group", "chatGroup", "outside"].includes(row.kind) || p.showPreview || state.working || Boolean(line && (line.tone === "attn" || line.tone === "bad"));
  const text = line ?? (twoLine ? { text: row.preview || p.fallbackLine || "", word: "", tone: "" } : null);
  const hue = colourHue(row.color);
  const classes = ["row", current ? "current" : "", twoLine ? "" : "one", p.dimmed ? "dim" : "", p.child ? "child" : "", p.selected ? "sel" : ""].filter(Boolean).join(" ");
  const badges = badgeList(row, p.extras);
  const card = (el: HTMLElement | null) => p.onCard?.(el);
  return (
    <div className="rw" style={p.depth ? { ["--dep" as string]: p.depth } : undefined} data-selected={p.selected ? "true" : undefined}>
      {p.kids && p.kids.count > 0 ? (
        <button type="button" className="chv" aria-expanded={p.kids.open} aria-label={`${p.kids.open ? "Fold" : "Unfold"} its conversations`} onClick={p.kids.onToggle}>
          <Icon name={p.kids.open ? "down" : "chev"} size={12} />
        </button>
      ) : null}
      <div
        className={classes}
        data-testid="conversation-row"
        data-key={row.key}
        data-drag-key={row.key}
        data-pin-key={p.pinDraggable ? row.key : undefined}
        data-pin-fixed={p.pinFixed ? "true" : undefined}
        data-main={row.isMain ? "true" : undefined}
        style={hue ? { ["--clr" as string]: hue } : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onMenu(e);
        }}
        onPointerEnter={(e) => card(e.currentTarget)}
        onPointerLeave={() => card(null)}
      >
        <button type="button" className="row-open" aria-current={current ? "true" : undefined} aria-selected={p.selected ? true : undefined} title={name} onClick={p.onOpen}
          onKeyDown={(e) => { if (e.key === "F10" && e.shiftKey) { e.preventDefault(); p.onMenu(e as unknown as MouseEvent<HTMLElement>); } }}
          onFocus={(e) => e.currentTarget.matches(":focus-visible") && card(e.currentTarget.parentElement)} onBlur={() => card(null)}>
          <span className={state.working ? "row-av working-ring" : "row-av"} data-working={state.working ? "true" : undefined}>
            {row.roomPicks ? <RoomFaces picks={row.roomPicks} size={twoLine ? 40 : 28} /> : <Pebble size={twoLine ? 40 : 28} label={row.kind === "group" || row.kind === "chatGroup" || row.kind === "outside" ? row.title : p.trunkName} where={p.where} state={state.waiting ? "wait" : state.working ? "work" : "idle"} priority={state.working || state.waiting ? 200 : 100} />}
            {row.unread && !current ? <i className="rail-unread" aria-label="Unread" /> : null}
            {state.waiting ? <i className="needs-you" aria-label="Waiting for you" /> : null}
            {p.selected ? <span className="sel-tick" aria-hidden="true"><Icon name="tick" size={11} /></span> : null}
          </span>
          <b className="row-name">
            <span className="nm">
              <RowIcon value={row.icon} />
              <span className="nm-t">{name}</span>
            </span>
            {row.done ? <span className="bdg" title="Done" role="img" aria-label="Done"><Icon name="check" size={13} /></span> : null}
            {badges.map((b) => (
              <span key={b.words} className="bdg" title={b.words} role="img" aria-label={b.words}>
                <Icon name={b.icon} size={13} />
              </span>
            ))}
          </b>
          <RightColumn row={row} p={p} mark={mark} />
          {twoLine && text ? <SecondLine line={text} /> : null}
        </button>
        <span className="row-acts">{rowButtons(p, row)}</span>
      </div>
    </div>
  );
}

function SecondLine({ line }: { line: Line }) {
  if (line.typing) {
    return (
      <p className="row-preview" data-testid="row-typing">
        <span className="rowTypT5" aria-label="typing"><i /><i /><i /></span>
        {" "}typing…
      </p>
    );
  }
  return (
    <p className={line.tone === "attn" ? "row-preview waiting" : "row-preview"}>
      <span className="hl">{line.text}</span>
      {line.word ? <span className={`hw ${line.tone}`}> · {line.word}</span> : null}
    </p>
  );
}

function rowButtons(p: Props, row: Conversation): ReactNode {
  return (
    <>
      {p.onPin && !p.child ? (
        <button type="button" className="ib sm" aria-label={row.pinned ? "Unpin" : "Pin"} title={row.pinned ? "Unpin" : "Pin"} onClick={p.onPin}>
          <Icon name="pin" small />
        </button>
      ) : null}
      {p.onArchive && !p.child ? (
        <button type="button" className="ib sm" aria-label={row.archived ? "Restore" : "Archive"} title={row.archived ? "Restore" : "Archive"} onClick={p.onArchive}>
          <Icon name="archive" small />
        </button>
      ) : null}
      <button type="button" className="ib sm" aria-label="More" title="More" data-testid="row-more" onClick={(e) => p.onMenu(e)}>
        <Icon name="more" small />
      </button>
    </>
  );
}
