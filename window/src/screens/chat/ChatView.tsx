// The R1 conversation (card #808, HANDOFF R1-03): history from chat.history and the live run from the engine's
// agent/chat stream (connect/session.ts orders it with connect/stream-order.ts), drawn in the approved preview's look:
// bubbles, the 3-button hover bar, calm steps, thin notices and time dividers. Every message action goes through
// thread/useMessageActions (engine calls) or shows Coming. Classic pieces this card doesn't restyle (approval cards,
// the plan card, helpers, the waiting line, find and the turn rail) are imported, not copied, so nothing that works
// today is lost.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CapabilityProvider, useCapabilityEngine } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { QueuedMessage, RunEnd, SteeredNote } from "../../connect/session";
import { currentModelRef } from "../../composer/model";
import { hasNoModel, useConversation } from "../../composer/useConversation";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { resolveApproval } from "../../thread/actions";
import { EXAMPLES_GREETING_KEY, useExamplesHistory } from "./examples-greeting";
import { ApprovalCard, ApprovalGroup } from "../../thread/ApprovalCard";
import { ComputerActivityCard } from "../../thread/ComputerActivityCard";
import { turnDoneLines } from "../../thread/computer-card";
import { copyText, ThreadContext, type ThreadContextValue } from "../../thread/context";
import { ReactionChips } from "../../thread/dialogs";
import { startersFor } from "../../thread/EmptyState";
import { FindBar, useFindKey } from "../../thread/FindBar";
import { shortReason, workingLine } from "../../thread/format";
import { HelpersChip } from "../../thread/Helpers";
import { isComputerStep, layout, shownApprovalIds } from "../../thread/layout";
import type { Approval, ApprovalDecision, Block } from "../../thread/model";
import { PlanCard } from "../../thread/PlanCard";
import { useConversationPrefs } from "../../thread/prefs";
import { QueuedMessages, useOwnWaitingLine } from "../../thread/QueuedMessages";
import { Rail } from "../../thread/Rail";
import { suggestionsFor } from "../../thread/suggestions";
import { useApprovalDetails, useHelpers, useReactions, type ApprovalDetails } from "../../thread/useEngineData";
import { useMessageActions, type MessageChanges, type ReplyTarget } from "../../thread/useMessageActions";
import { Icon } from "../../shell/icons";
import { shows, useLevel } from "../../places-nav/level";
import { blockTime, dividerPositions, entriesOf, useWorkMode, type Entry, type WorkMode } from "./chat-logic";
import { HoverBar } from "./HoverBar";
import { NoticeLine, TimeDivider, WorkingLine } from "./lines";
import { AgentReply, TimeLine, UserBubble } from "./Message";
import { LoneThought, StepsList } from "./Steps";
import { foldTalks } from "../../rooms/fold";
import { RoomLine } from "../../rooms/RoomLine";
import { RoomMessage } from "../../rooms/RoomMessage";
import { ExchangeLine, ExchangeView, type ExchangeNames, type OpenExchange } from "./Exchange";
import { fromName, otherSender, type ThreadRoom } from "../../rooms/thread-room";
import { roomEntries, type RoomEntry } from "./room-entries";
import "../../thread/thread.css";
import "./chat.css";

export type ChatViewProps = {
  name: string;
  history: Block[];
  /** False until the transcript was read: an empty list is still loading, not a new conversation. */
  historyReady?: boolean;
  live: Block[];
  pendingUser: string | null;
  queued?: QueuedMessage[];
  steered?: SteeredNote[];
  running: boolean;
  engine?: WindowEngine;
  sessionKey?: string | null;
  /** The conversation couldn't be read (chat.history failed). */
  loadError?: string | null;
  /** Its Trunk is still getting ready: the window's startup line says so above, so no "Opening…" line or start screen here. */
  startupWaiting?: boolean;
  ended?: RunEnd | null;
  onAnswer: (id: string, decision: "allow-once" | "deny") => void;
  onReload?: () => void;
  onOpenSession?: (key: string) => void;
  onToast?: (text: string) => void;
  /** Opens the re-hosted Classic helpers view (parity row 3); without it the chip keeps its own popover. */
  onOpenHelpers?: () => void;
  /** Sends a starter or a suggested reply the way the composer sends (chat.send). */
  onStart?: (text: string) => void;
  /** Puts "Replying to …" on the composer (chat.send replyToId). */
  onReply?: (target: ReplyTarget) => void;
  /** Who else writes here (rooms/useShellRoom): their rows, the Trunk-to-Trunk exchange lines and the room line (§4.2.4). */
  room?: ThreadRoom;
  /** An examples conversation with no messages yet: why this Trunk is here (examples-greeting.ts). */
  examplesWhy?: string;
};

function entryTime(entry: RoomEntry): number | undefined {
  if (entry.type === "talk") return undefined;
  if (entry.type === "item") return blockTime(entry.item.block);
  if (entry.type === "thought") return undefined;
  for (const step of entry.steps) { const at = blockTime(step); if (at) return at; }
  return undefined;
}

/** The scrolling element the frame owns (.r1-scroll), else the nearest scrolling ancestor. */
function scrollerOf(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement ?? null; el; el = el.parentElement) {
    if (el.classList.contains("r1-scroll")) return el;
    const style = getComputedStyle(el).overflowY;
    if (style === "auto" || style === "scroll") return el;
  }
  return null;
}

/** Auto-scroll only when the reader was already at the bottom, or when you just sent something. A conversation opens
 *  at its latest message: the frame resets its scroll on navigation, so that first jump waits a frame and wins. */
function useFollow(root: React.RefObject<HTMLDivElement | null>, signature: string, sent: string, conversation: string) {
  const atEnd = useRef(true), force = useRef(true);
  const scroller = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const node = root.current, el = scrollerOf(node);
    scroller.current = el as HTMLDivElement | null;
    if (!el || !node) return;
    const onScroll = () => { if (!force.current) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    // Streamed words, faces and pictures grow the thread without a new signature: stay pinned while at the end.
    const pin = new ResizeObserver(() => { if (atEnd.current) el.scrollTop = el.scrollHeight; });
    pin.observe(node);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { pin.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, [root]);
  useLayoutEffect(() => { force.current = true; atEnd.current = true; }, [conversation]);
  useEffect(() => { if (sent) atEnd.current = true; }, [sent]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = scroller.current;
      if (el && (atEnd.current || force.current)) el.scrollTop = el.scrollHeight;
      force.current = false;
      if (el) atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    });
    return () => cancelAnimationFrame(id);
  }, [signature, sent, conversation]);
  return scroller;
}

/** Approvals raised before this connection or by a plugin, not yet drawn as a card (Classic Thread's rule). */
function pendingExtras(details: Map<string, ApprovalDetails>, shown: Set<string>, sessionKey?: string | null): Approval[] {
  return [...details.values()]
    .filter((d) => !d.decision && !shown.has(d.id) && (!d.sessionKey || d.sessionKey === sessionKey) && (!d.expiresAtMs || d.expiresAtMs > Date.now()))
    .map((d) => ({ id: d.id, command: d.command ?? "", cwd: d.cwd, host: d.host, state: "pending" }));
}

function EmptyChat({ name, engine, onStart }: { name: string; engine?: WindowEngine; onStart?: (text: string) => void }) {
  return <div className="r1c-empty" data-testid="empty-chat">
    <Face size={72} label={name} state="idle" reactive />
    <h1 className="r1c-empty-title">What should {name || "it"} do?</h1>
    {onStart ? <Starters engine={engine} onStart={onStart} /> : null}
  </div>;
}

/** Three starters for what this agent is for, once a model is set up (composer/useConversation). */
function Starters({ engine, onStart }: { engine?: WindowEngine; onStart: (text: string) => void }) {
  const conv = useConversation(engine);
  if (!conv.loaded || hasNoModel(conv, currentModelRef(conv.row, conv.defaults))) return null;
  const list = startersFor(conv.trunk?.theme ?? "", !conv.trunk || conv.trunk.id === conv.defaultTrunkId).slice(0, 3);
  return <div className="r1c-chips" role="group" aria-label="Starters">
    {list.map((text) => <Coming key={text} need="chat.send"><button type="button" className="r1c-chip" onClick={() => onStart(text)}>{text}</button></Coming>)}
  </div>;
}

export function ChatView(props: ChatViewProps) {
  const { name, live, pendingUser, running, engine, onToast } = props;
  // In an examples conversation the empty history shows the Trunk's introduction instead (examples-greeting.ts).
  const history = useExamplesHistory({ history: props.history, live, why: props.examplesWhy, historyReady: props.historyReady !== false, name, engine });
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);
  const prefs = useConversationPrefs(engine);
  const work = useWorkMode(engine, props.sessionKey);
  const prefKey = JSON.stringify(prefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx: ThreadContextValue = useMemo(() => ({ engine, sessionKey: props.sessionKey, name, toast, running, prefs }), [engine, props.sessionKey, name, toast, running, prefKey]);
  const ownLine = useOwnWaitingLine(props.sessionKey ?? engine?.sessionKey);
  // Every Coming control in the conversation checks this engine's methods; a frame that already mounts one wins.
  const capabilities = useCapabilityEngine() ?? engine ?? null;
  const { details } = useApprovalDetails(engine);
  const { reactions, apply } = useReactions(engine, history.length);
  const { helpers } = useHelpers(engine);
  const all = useMemo(() => [...history, ...(running ? live : [])], [history, live, running]);
  const extras = pendingExtras(details, shownApprovalIds(all), engine?.sessionKey);
  const answer = useCallback((id: string, decision: ApprovalDecision) => {
    const plugin = details.get(id)?.plugin ?? false;
    if (engine && (decision === "allow-always" || plugin)) resolveApproval(engine, id, decision, plugin).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
    else if (decision !== "allow-always") props.onAnswer(id, decision);
  }, [details, engine, props, toast]);
  const waitingTwo = [...all.filter((b): b is Extract<Block, { kind: "approval" }> => b.kind === "approval").map((b) => b.approval), ...extras].filter((a) => a.state === "pending");
  const grouped = new Set(waitingTwo.length === 2 ? waitingTwo.map((a) => a.id) : []);
  const { actionsFor, dialog, changes } = useMessageActions(ctx, { onReload: props.onReload, onOpenSession: props.onOpenSession, onReply: props.onReply, applyReaction: apply });
  const root = useRef<HTMLDivElement>(null);
  const liveText = live.reduce((n, b) => n + (b.kind === "text" || b.kind === "thinking" ? b.text.length : 1), 0);
  const signature = history.length + ":" + live.length + ":" + liveText + ":" + (running ? 1 : 0) + ":" + extras.length + ":" + (props.queued?.length ?? 0);
  const scroller = useFollow(root, signature, (pendingUser ?? "") + (ownLine.at(-1)?.id ?? ""), props.sessionKey ?? "");
  // Find in this conversation. A search result that opens here passes its words, and a new request starts a fresh bar.
  const [finding, setFinding] = useState<{ query?: string; nonce: number } | null>(null);
  useFindKey(useCallback((query?: string) => setFinding(current => (query ? { query, nonce: (current?.nonce ?? 0) + 1 } : current ?? { nonce: 0 })), []));
  const [usedSuggestion, setUsedSuggestion] = useState<string | null>(null);

  const historyReady = props.historyReady !== false;
  const waitingCount = (props.queued?.length ?? 0) + ownLine.length;
  const empty = historyReady && !history.length && !pendingUser && !running && !waitingCount && !props.loadError && !props.startupWaiting;
  // As in the Classic thread: with a room, exchanges between Trunks fold (rooms/fold.ts), here into one centred line.
  const inRoom = Boolean(props.room), ownAgentId = props.room?.ownAgentId;
  const entries = useMemo<RoomEntry[]>(() => (inRoom ? roomEntries(foldTalks(layout(history), ownAgentId)) : entriesOf(layout(history))), [history, inRoom, ownAgentId]);
  const times = useMemo(() => entries.map(entryTime), [entries]);
  // Trunk-to-Trunk exchanges: one centred line each, opened read-only over the chat (./Exchange).
  const [exchange, setExchange] = useState<OpenExchange | null>(null);
  const trunkName = props.room?.trunkName;
  const exchangeNames = useMemo<ExchangeNames>(() => {
    const at = new Map(history.map((b) => [b.key, blockTime(b)]));
    return { ownName: name, trunkName: trunkName ?? ((id: string) => id), timeOf: (key) => at.get(key) };
  }, [history, name, trunkName]);
  useEffect(() => { setExchange(null); }, [props.sessionKey]);
  const dividers = useMemo(() => dividerPositions(times), [times]);
  const lastUser = history.map((b) => b.kind).lastIndexOf("user");
  const lastReply = [...history].reverse().find((b) => b.kind === "text");
  const suggestionKey = lastReply ? (props.sessionKey ?? "") + ":" + lastReply.key : null;
  const suggestions = props.onStart && !waitingTwo.length && suggestionKey !== usedSuggestion ? suggestionsFor(history, running, Boolean(pendingUser)) : [];
  const helperChip = helpers.length && engine?.sessionKey ? <HelpersChip helpers={helpers} approvals={[...details.values()]} root={engine.sessionKey} onAnswer={answer} onOpenSession={props.onOpenSession} onOpenActivity={props.onOpenHelpers}
    onStop={(h) => engine.request("sessions.abort", { key: h.key }).then(() => toast("Stopped " + h.name + ". " + name + " carries on without it."), (e: unknown) => toast(e instanceof Error ? e.message : String(e)))} /> : null;

  const view: View = { all, name, running, live, actionsFor, changes, reactions, apply, details, answer, grouped, times: prefs.messageTimes, mode: work.mode, lastUser, engine, onOpenSession: props.onOpenSession, toast, room: props.room };
  const liveEntries = running ? entriesOf(layout(live.filter((b) => b.kind !== "status"), history.length)) : [];
  // The run's token count (the engine's usage block), as Classic's live-run header shows it; once something visible arrives.
  const usage = running ? live.find((b): b is Extract<Block, { kind: "usage" }> => b.kind === "usage") : undefined;
  // Regular, live: a steps row that ends the run carries the working line in its own summary (one line, a disclosure).
  const full = shows(useLevel(), "advanced");
  const workText = workingLine(live);
  const inlineSteps = running && !full && liveEntries.at(-1)?.type === "steps";
  const liveShows = live.some((b) => b.kind === "text" || b.kind === "step" || b.kind === "plan" || b.kind === "preamble" || (b.kind === "approval") || (b.kind === "thinking" && work.mode !== "normal"));
  return <CapabilityProvider engine={capabilities}><ThreadContext.Provider value={ctx}>
    <div className="r1c" ref={root} data-mode={work.mode} data-times={prefs.messageTimes} dir={prefs.dir}>
      {finding ? <FindBar key={finding.nonce} root={root} name={name} signature={signature} initialQuery={finding.query} onClose={() => setFinding(null)} /> : null}
      <div className="r1c-thread">
        {props.loadError ? <NoticeLine tone="bad" text="Couldn’t load this conversation" details={props.loadError} links={props.onReload ? [{ label: "Try again", onClick: props.onReload, need: "chat.history", reason: "This engine can’t read conversations." }] : []} testid="load-error" /> : null}
        {empty ? <EmptyChat name={name} engine={engine} onStart={props.onStart} /> : !historyReady && !history.length && !props.loadError && !props.startupWaiting ? <NoticeLine text="Opening this conversation…" testid="opening" /> : null}
        {entries.map((entry, i) => <Fragment key={entry.type === "item" ? entry.item.block.key : entry.key}>
          {dividers.has(i) && times[i] ? <TimeDivider at={times[i]!} /> : null}
          {entry.type === "talk" ? <ExchangeLine talk={entry.talk} names={exchangeNames} onOpen={setExchange} /> : <EntryView entry={entry} view={view} live={false} />}
        </Fragment>)}
        {props.room ? <RoomLine history={history} room={props.room} ownName={name} /> : null}
        {pendingUser ? <UserBubble block={{ kind: "user", key: "pending", text: pendingUser }} /> : null}
        <QueuedMessages queued={props.queued ?? []} own={ownLine} part="delivered" />
        {running ? liveEntries.map((entry, i) => <EntryView key={entry.type === "item" ? entry.item.block.key : entry.key} entry={entry} view={view} live working={inlineSteps && i === liveEntries.length - 1 ? workText : undefined} />) : null}
        {running && !waitingTwo.length && !inlineSteps ? <div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body"><WorkingLine label={workText} /></div></div> : null}
        {running && liveShows && usage?.total ? <NoticeLine text={usage.total.toLocaleString() + " tokens so far"} testid="live-usage" /> : null}
        {running ? (props.steered ?? []).map((note) => <NoticeLine key={note.runId} text={"You steered " + name + ": “" + note.text + "”. It takes this at its next step."} testid="steered-note" />) : null}
        <QueuedMessages queued={props.queued ?? []} own={ownLine} part="waiting" sessionKey={props.sessionKey ?? engine?.sessionKey ?? undefined} />
        {extras.filter((a) => !grouped.has(a.id)).map((a) => <ApprovalCard key={a.id} approval={a} details={details.get(a.id)} name={name} onAnswer={answer} />)}
        {grouped.size === 2 ? <ApprovalGroup approvals={waitingTwo} details={details} name={name} onAnswer={answer} /> : null}
        {helperChip}
        {suggestions.length ? <div className="r1c-chips r1c-suggest" role="group" aria-label="Suggested replies" data-testid="suggestion-row">
          {suggestions.map((text) => <Coming key={text} need="chat.send"><button type="button" className="r1c-chip" title={"Send “" + text + "” as your reply"} onClick={() => { setUsedSuggestion(suggestionKey); props.onStart?.(text); }}>{"“" + text + "”"}</button></Coming>)}
        </div> : null}
      </div>
      <Rail scroller={scroller} blocks={all} sessionKey={props.sessionKey} />
      {exchange ? <ExchangeView key={exchange.talk.key} open={exchange} names={exchangeNames} host={root.current?.closest<HTMLElement>(".r1-conversation") ?? null} onClose={() => setExchange(null)} /> : null}
    </div>
    {dialog}
  </ThreadContext.Provider></CapabilityProvider>;
}

type View = {
  all: Block[]; live: Block[]; name: string; running: boolean; lastUser: number; mode: WorkMode;
  actionsFor: ReturnType<typeof useMessageActions>["actionsFor"];
  /** Pins set and messages deleted here, shown at once before the next history read. */
  changes: MessageChanges;
  reactions: ReturnType<typeof useReactions>["reactions"];
  apply: (id: string, raw: unknown) => void;
  details: Map<string, ApprovalDetails>;
  answer: (id: string, d: ApprovalDecision) => void;
  grouped: Set<string>;
  times: "hover" | "always" | "never";
  engine?: WindowEngine;
  onOpenSession?: (key: string) => void;
  toast: (text: string) => void;
  room?: ThreadRoom;
};

/** "Put back" under a message left out of context calls the same method as the menu row. */
const PUT_BACK = { need: "session.context.set", reason: "This engine can’t put a message back in context." };

function faceFor(view: View, live: boolean): ReactNode {
  return <Face size={28} label={view.name} state={live && view.running ? "think" : "idle"} priority={live ? 300 : 100} />;
}

/** In a group chat, another Trunk's post carries that Trunk's face, not this conversation's (Classic thread). */
function postedFace(block: Extract<Block, { kind: "text" }>, view: View): ReactNode | null {
  const sender = block.meta?.sender;
  if (!view.room?.isRoom || sender?.kind !== "trunk" || !sender.posted) return null;
  return <Face size={28} label={view.room.trunkName(sender.agentId)} priority={100} />;
}

function EntryView({ entry, view, live, working }: { entry: Entry; view: View; live: boolean; working?: string }) {
  if (entry.type === "thought") return <div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body"><LoneThought thought={entry.thought} mode={view.mode} /></div></div>;
  if (entry.type === "steps") {
    const computer = entry.steps.some(isComputerStep);
    return <div className="r1c-row r1c-b" data-block-key={entry.steps[0]?.key} data-block-keys={entry.steps.map((s) => s.key).join(" ")}>
      <div className="r1c-gut" data-working={(live && view.running) || undefined}>{entry.face ? faceFor(view, live) : null}</div>
      <div className="r1c-body">
        <StepsList steps={entry.steps} thoughts={entry.thoughts} live={live} mode={view.mode} working={working} />
        {computer ? <ComputerActivityCard blocks={[...entry.steps, ...turnDoneLines(entry.steps, view.all)]} running={view.running} name={view.name} engine={view.engine} gatewayUrl={view.engine?.gatewayUrl} onWatch={() => undefined} /> : null}
      </div>
    </div>;
  }
  const { block, index, face } = entry.item;
  const wrap = (node: ReactNode) => <div className="r1c-row r1c-b" data-block-key={block.key}><div className="r1c-gut" /><div className="r1c-body">{node}</div></div>;
  switch (block.kind) {
    case "user":
    case "text": {
      const entryId = block.meta?.entryId;
      if (entryId && view.changes.gone.has(entryId)) return null;
      const actions = live || block.key === EXAMPLES_GREETING_KEY ? null : view.actionsFor(view.all, index);
      const pinned = (entryId ? view.changes.pinned.get(entryId) : undefined) ?? block.meta?.pinned === true;
      const chips = entryId ? view.reactions.get(entryId) ?? [] : [];
      const isReply = block.kind === "text";
      const other = block.kind === "user" ? otherSender(block, view.room) : null;
      const bar = actions ? <HoverBar text={block.text} isReply={isReply} actions={actions} meta={block.meta} /> : null;
      const after = <>
        {pinned ? <div className="r1c-pin-line" data-testid="pinned-mark"><Icon name="pin" size={12} />Pinned</div> : null}
        {block.meta?.excluded && actions?.context ? <div className="r1c-out-line">Left out of context · <Coming need={PUT_BACK.need} reason={PUT_BACK.reason} where="Put back"><button type="button" className="r1c-link" aria-disabled={actions.context.disabled ? "true" : undefined} title={actions.context.disabled ?? undefined} onClick={() => { if (!actions.context?.disabled) actions.context?.run(); }}>Put back</button></Coming></div> : null}
        {live ? null : <TimeLine at={block.meta?.timestamp} model={isReply ? block.meta?.model : undefined} mine={!isReply && !other} mode={view.times} />}
        <ReactionChips list={chips} onToggle={(emoji, remove) => { if (actions && !actions.reactDisabled) actions.react(emoji, remove); }} />
      </>;
      const posted = block.kind === "text" ? postedFace(block, view) : null;
      return <div data-block-key={block.key} data-pinned={pinned || undefined}>{block.kind === "user"
        ? other
          ? <div className="r1c-row r1c-room"><RoomMessage sender={other} text={block.text} attachments={block.attachments} entryId={block.meta?.entryId} where={other.kind === "agent" ? view.room?.whereRuns(other.id) ?? null : null} online={other.kind === "agent" && view.room?.isOnline?.(other.id) === true}>{bar}</RoomMessage>{after}</div>
          : <UserBubble block={block} bar={bar} after={after} />
        : <AgentReply block={block} face={face ? posted ?? faceFor(view, live) : undefined} working={face && !posted && view.running && (live || index > view.lastUser)} from={fromName(block, face, view.room, view.name)} bar={bar} after={after} grow={live && !block.streaming} />}</div>;
    }
    case "plan":
      return wrap(<PlanCard card={{ sessionKey: "run", revision: 1, updatedAt: Date.now(), steps: block.steps }} />);
    case "approval":
      return view.grouped.has(block.approval.id) ? null : wrap(<ApprovalCard approval={block.approval} details={view.details.get(block.approval.id)} name={view.name} onAnswer={view.answer} />);
    case "preamble":
      return wrap(<p className="r1c-pre" data-testid="preamble">{block.text}</p>);
    case "done":
      return block.stopped ? <NoticeLine text="Stopped · what it did so far is kept." testid="run-stopped" /> : null;
    case "error":
      return <NoticeLine tone="bad" text={view.name + " couldn’t finish: " + shortReason(block.message)} details={block.message} links={[{ label: "Copy error", onClick: () => void copyText(block.message, view.toast) }]} testid="run-error" />;
    case "notice":
      return <NoticeLine text={block.text} links={block.topicKey && view.onOpenSession ? [{ label: "Open", onClick: () => view.onOpenSession?.(block.topicKey!) }] : []} />;
    case "steer":
      return <NoticeLine text={"You steered " + view.name + ": “" + block.text + "”."} testid="steered-note" />;
    default:
      return null;
  }
}
