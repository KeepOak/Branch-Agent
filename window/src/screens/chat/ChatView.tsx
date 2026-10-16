// The R1 conversation (card #808, HANDOFF R1-03): history from chat.history and the live run from the engine's
// agent/chat stream (connect/session.ts orders it with connect/stream-order.ts), drawn in the approved preview's look:
// bubbles, the 3-button hover bar, calm steps, thin notices and time dividers. Every message action goes through
// thread/useMessageActions (engine calls) or shows Coming. Classic pieces this card doesn't restyle (approval cards,
// the plan card, helpers, the waiting line, find and the turn rail) are imported, not copied, so nothing that works
// today is lost.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CapabilityProvider, useCapabilityEngine } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { QueuedMessage, RunEnd, SteeredNote } from "../../connect/session";
import { ConnectModelNotice } from "../../composer/ConnectModelNotice";
import { isNoUsableModelError } from "../../composer/connect-model";
import { currentModelRef } from "../../composer/model";
import { hasNoModel, useConversation } from "../../composer/useConversation";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { resolveApproval } from "../../thread/actions";
import { AskCard, AskGroup, Decided, askOfApproval, settledOfApproval, useAskGroup, type AskState, type Reply } from "../approvals";
import { EXAMPLES_GREETING_KEY, useExamplesHistory } from "./examples-greeting";
import { ComputerActivityCard } from "../../thread/ComputerActivityCard";
import { turnDoneLines } from "../../thread/computer-card";
import { copyText, ThreadContext, type ThreadContextValue } from "../../thread/context";
import { ReactionChips } from "../../thread/dialogs";
import { startersFor } from "../../thread/EmptyState";
import { FindBar, useFindKey } from "../../thread/FindBar";
import { currentStepWords, liveWorkingLine, shortReason, workingLine } from "../../thread/format";
import { HelpersChip } from "../../thread/Helpers";
import { isComputerStep, layout } from "../../thread/layout";
import type { ApprovalDecision, Block } from "../../thread/model";
import { PlanCard } from "../../thread/PlanCard";
import { useConversationPrefs } from "../../thread/prefs";
import { QueuedMessages, useOwnWaitingLine } from "../../thread/QueuedMessages";
import { Rail } from "../../thread/Rail";
import { suggestionsFor } from "../../thread/suggestions";
import { useApprovalDetails, useHelpers, useReactions } from "../../thread/useEngineData";
import { useMessageActions, type MessageChanges, type ReplyTarget } from "../../thread/useMessageActions";
import { Icon } from "../../shell/icons";
import { shows, useLevel } from "../../places-nav/level";
import { answerBelowWorkingLine, blockTime, dividerPositions, entriesOf, useWorkMode, type Entry, type WorkMode } from "./chat-logic";
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
  /** What the engine waits on (approvals/useAsks): each approval in this conversation draws its card from here. */
  asks?: readonly AskState[];
  /** Answers one of them through its own call (approvals/useAsks answer). */
  onAsk?: (id: string, reply: Reply) => void;
  /** Lockdown is on: only No can be answered. */
  lockdown?: boolean;
  /** An examples conversation with no messages yet: why this Trunk is here (examples-greeting.ts). */
  examplesWhy?: string;
};

const NO_ASKS: readonly AskState[] = [];

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

/** A one-second clock for a live reply. The time is read outside render, so the line can show how long the work has taken. */
const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;
function subscribeClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  if (!clockTimer) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      clockListeners.forEach((listener) => listener());
    }, 1000);
    queueMicrotask(onChange);
  }
  return () => {
    clockListeners.delete(onChange);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}
const readClock = () => clockNow;
const idleClock = () => 0;
const noClock = () => () => undefined;

/** How long this live reply has been going, from its first step. */
function useWorkingElapsed(running: boolean, startedAt: number | undefined): number {
  const now = useSyncExternalStore(running ? subscribeClock : noClock, running ? readClock : idleClock, idleClock);
  if (!running || startedAt === undefined || !now) return 0;
  return Math.max(0, now - startedAt);
}

function earliestStepAt(blocks: readonly Block[]): number | undefined {
  let min: number | undefined;
  for (const block of blocks) {
    if (block.kind !== "step" || typeof block.at !== "number" || !(block.at > 0)) continue;
    if (min === undefined || block.at < min) min = block.at;
  }
  return min;
}

function EmptyChat({ name, engine, onStart }: { name: string; engine?: WindowEngine; onStart?: (text: string) => void }) {
  const conv = useConversation(engine);
  const noModel = conv.loaded && hasNoModel(conv, currentModelRef(conv.row, conv.defaults));
  return <div className="r1c-empty" data-testid="empty-chat">
    <Face size={72} label={name} state="idle" reactive />
    <h1 className="r1c-empty-title">What should {name || "it"} do?</h1>
    {noModel ? <ConnectModelNotice className="r1c-connect" /> : onStart ? <Starters engine={engine} onStart={onStart} /> : null}
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
  const asks = props.asks ?? NO_ASKS;
  const askCards = useMemo(() => new Map(asks.map((s) => [s.ask.id, s] as const)), [asks]);
  const answer = useCallback((id: string, decision: ApprovalDecision) => {
    const plugin = details.get(id)?.plugin ?? false;
    if (engine && (decision === "allow-always" || plugin)) resolveApproval(engine, id, decision, plugin).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
    else if (decision !== "allow-always") props.onAnswer(id, decision);
  }, [details, engine, props, toast]);
  // What waits in this conversation: two or more approvals group into one card at the foot (preview ask2); the rest get
  // their own card at the foot too, unless their approval block already draws it.
  const here = asks.filter((s) => s.status !== "settled" && Boolean(props.sessionKey) && s.ask.sessionKey === props.sessionKey);
  const members = useAskGroup(props.sessionKey ?? null, here);
  const grouped = new Set(members);
  const blockIds = new Set(all.flatMap((b) => (b.kind === "approval" ? [b.approval.id] : [])));
  const loose = here.filter((s) => !blockIds.has(s.ask.id) && !grouped.has(s.ask.id));
  const waitingHere = here.length > 0 || all.some((b) => b.kind === "approval" && b.approval.state === "pending");
  const answerAsk = (id: string, reply: Reply) => props.onAsk?.(id, reply);
  const { actionsFor, dialog, changes } = useMessageActions(ctx, { onReload: props.onReload, onOpenSession: props.onOpenSession, onReply: props.onReply, applyReaction: apply, selfId: props.room ? props.room.selfId : null });
  const root = useRef<HTMLDivElement>(null);
  const liveText = live.reduce((n, b) => n + (b.kind === "text" || b.kind === "thinking" ? b.text.length : 1), 0);
  const signature = history.length + ":" + live.length + ":" + liveText + ":" + (running ? 1 : 0) + ":" + here.length + ":" + (props.queued?.length ?? 0);
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
  const suggestions = props.onStart && !waitingHere && suggestionKey !== usedSuggestion ? suggestionsFor(history, running, Boolean(pendingUser)) : [];
  const helperChip = helpers.length && engine?.sessionKey ? <HelpersChip helpers={helpers} approvals={[...details.values()]} root={engine.sessionKey} onAnswer={answer} onOpenSession={props.onOpenSession} onOpenActivity={props.onOpenHelpers}
    onStop={(h) => engine.request("sessions.abort", { key: h.key }).then(() => toast("Stopped " + h.name + ". " + name + " carries on without it."), (e: unknown) => toast(e instanceof Error ? e.message : String(e)))} /> : null;

  const view: View = { all, name, running, live, actionsFor, changes, reactions, apply, asks: askCards, grouped, answerAsk, lockdown: Boolean(props.lockdown), times: prefs.messageTimes, mode: work.mode, lastUser, engine, onOpenSession: props.onOpenSession, toast, room: props.room };
  const liveEntries = running ? entriesOf(layout(live.filter((b) => b.kind !== "status"), history.length)) : [];
  // The run's token count (the engine's usage block), as Classic's live-run header shows it; once something visible arrives.
  const usage = running ? live.find((b): b is Extract<Block, { kind: "usage" }> => b.kind === "usage") : undefined;
  // Regular: one quiet working line. It is the steps disclosure when the run has steps, and it stays above the answer.
  const full = shows(useLevel(), "advanced");
  const quiet = !full;
  const elapsed = useWorkingElapsed(running, earliestStepAt(live));
  const workText = quiet ? liveWorkingLine(currentStepWords(live), elapsed) : workingLine(live);
  const shownLive = running ? (quiet ? answerBelowWorkingLine(liveEntries) : liveEntries) : [];
  const lastSteps = shownLive.findLastIndex((entry) => entry.type === "steps");
  const inlineSteps = quiet && lastSteps >= 0;
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
        {running && quiet && !waitingHere && !inlineSteps ? <div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body"><WorkingLine label={workText} /></div></div> : null}
        {running ? shownLive.map((entry, i) => <EntryView key={entry.type === "item" ? entry.item.block.key : entry.key} entry={entry} view={view} live working={inlineSteps && i === lastSteps ? workText : undefined} />) : null}
        {running && !quiet && !waitingHere ? <div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body"><WorkingLine label={workText} /></div></div> : null}
        {running && liveShows && usage?.total ? <NoticeLine text={usage.total.toLocaleString() + " tokens so far"} testid="live-usage" /> : null}
        {running ? (props.steered ?? []).map((note) => <NoticeLine key={note.runId} text={"You steered " + name + ": “" + note.text + "”. It takes this at its next step."} testid="steered-note" />) : null}
        <QueuedMessages queued={props.queued ?? []} own={ownLine} part="waiting" sessionKey={props.sessionKey ?? engine?.sessionKey ?? undefined} />
        {members.length ? <AskGroup members={members.flatMap((id) => askCards.get(id) ?? [])} name={name} lockdown={props.lockdown} onAnswer={answerAsk} /> : null}
        {loose.map((s) => <AskCard key={s.ask.id} state={s} name={name} onAnswer={answerAsk} lockdown={props.lockdown} scopes={engine?.scopes} />)}
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
  asks: Map<string, AskState>;
  /** The approvals drawn by the group card, not by their own block. */
  grouped: Set<string>;
  answerAsk: (id: string, reply: Reply) => void;
  lockdown: boolean;
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

/** An approval in the conversation: its R1 card while the engine has it (approvals/useAsks), else its decided line. */
function ApprovalBlock({ block, view }: { block: Extract<Block, { kind: "approval" }>; view: View }) {
  const state = view.asks.get(block.approval.id);
  const ask = askOfApproval(block.approval);
  if (view.grouped.has(block.approval.id)) return null;
  let card: ReactNode = null;
  if (state) card = <AskCard state={state} name={view.name} onAnswer={view.answerAsk} lockdown={view.lockdown} scopes={view.engine?.scopes} />;
  else if (ask && block.approval.state !== "pending") card = <Decided ask={ask} how={settledOfApproval(block.approval)} name={view.name} />;
  if (!card) return null;
  return <div className="r1c-row r1c-b" data-block-key={block.key}><div className="r1c-gut" /><div className="r1c-body">{card}</div></div>;
}

function EntryView({ entry, view, live, working }: { entry: Entry; view: View; live: boolean; working?: string }) {
  if (entry.type === "thought") return <div className="r1c-row r1c-b"><div className="r1c-gut" /><div className="r1c-body"><LoneThought thought={entry.thought} mode={view.mode} /></div></div>;
  if (entry.type === "steps") {
    const computer = entry.steps.some(isComputerStep);
    return <div className="r1c-row r1c-b" data-block-key={entry.steps[0]?.key} data-block-keys={entry.steps.map((s) => s.key).join(" ")}>
      <div className="r1c-gut" data-working={(live && view.running) || undefined}>{entry.face ? faceFor(view, live) : null}</div>
      <div className="r1c-body">
        <StepsList steps={entry.steps} thoughts={entry.thoughts} live={live} mode={view.mode} working={working} durationMs={live ? undefined : entry.run?.durationMs} />
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
      return <ApprovalBlock block={block} view={view} />;
    case "preamble":
      return wrap(<p className="r1c-pre" data-testid="preamble">{block.text}</p>);
    case "done":
      return block.stopped ? <NoticeLine text="Stopped · what it did so far is kept." testid="run-stopped" /> : null;
    case "error":
      return isNoUsableModelError(block.message)
        ? wrap(<ConnectModelNotice />)
        : <NoticeLine tone="bad" text={view.name + " couldn’t finish: " + shortReason(block.message)} details={block.message} links={[{ label: "Copy error", onClick: () => void copyText(block.message, view.toast) }]} testid="run-error" />;
    case "notice":
      return <NoticeLine text={block.text} links={block.topicKey && view.onOpenSession ? [{ label: "Open", onClick: () => view.onOpenSession?.(block.topicKey!) }] : []} />;
    case "steer":
      return <NoticeLine text={"You steered " + view.name + ": “" + block.text + "”."} testid="steered-note" />;
    default:
      return null;
  }
}
