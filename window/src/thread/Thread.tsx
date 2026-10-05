import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { agentState } from "../face/agentState";
import { PRIORITY } from "../face/cap";
import { resolveApproval } from "./actions";
import { ApprovalCard, ApprovalGroup } from "./ApprovalCard";
import { DoneLine, ErrorBlock, Notice, Reply, StepsFold, Thinking, Typing, UserMessage } from "./blocks";
import { ThreadContext, type ThreadContextValue } from "./context";
import { ReactionChips } from "./dialogs";
import { DoneCheer } from "./DoneCheer";
import { EmptyState } from "./EmptyState";
import { FindBar, useFindKey } from "./FindBar";
import { HelpersChip } from "./Helpers";
import { HoverBar } from "./HoverBar";
import { Rail } from "./Rail";
import { Icon, ICONS } from "./icons";
import { layout, shownApprovalIds, type Item } from "./layout";
import { planAnchor } from "./PlanCard";
import { useConversationPrefs } from "./prefs";
import { QuestionLine } from "./QuestionCard";
import { anchorQuestions, type QuestionRecord } from "./questions";
import type { Approval, ApprovalDecision, Block } from "./model";
import { approvalKeyFor } from "./approval-keys";
import { useApprovalDetails, useHelpers, useReactions, type ApprovalDetails } from "./useEngineData";
import { useMessageActions, type ReplyTarget } from "./useMessageActions";
import "./thread.css";
import "./activity-strip.css";
import { foldTalks, type RoomItem } from "../rooms/fold";
import { RoomMessage } from "../rooms/RoomMessage";
import { TalkedFold } from "../rooms/TalkedFold";
import { RoomLine } from "../rooms/RoomLine";
import { fromName, otherSender, type ThreadRoom } from "../rooms/thread-room";
import "./prefs.css";
import { dayStamp, fullTime, messageTime, modelName } from "./format";
import { TopicCard, TopicOrigin, topicPosition, type TopicUpdate } from "./TopicCard";

type Props = {
  supplement?: ReactNode;
  onOpenActivity?: () => void;
  name: string;
  history: Block[];
  live: Block[];
  pendingUser: string | null;
  running: boolean;
  onAnswer: (id: string, decision: "allow-once" | "deny") => void;
  /** The shared engine handle (connect/engine.ts); without it the message actions stay greyed with their reason. */
  engine?: WindowEngine;
  sessionKey?: string | null;
  /** Reads the conversation's history again (after a rewind or a resend). */
  onReload?: () => void;
  onToast?: (text: string) => void;
  onOpenSession?: (key: string) => void;
  onReply?: (target: ReplyTarget) => void;
  /** The conversation's questions (question.list); the waiting one is answered above the message box. */
  questions?: QuestionRecord[];
  /** Sends a starter from the empty conversation (§4.2.9), the same way the composer sends. */
  onStart?: (text: string) => void;
  /** The Plan card; it goes after the turn that last updated it (planAnchor), else at the end (§4.2.2). */
  plan?: ReactNode;
  /** Who else writes here (rooms/): other people, outside agents and other Trunks (§4.2.4). */
  room?: ThreadRoom;
  topicUpdates?: TopicUpdate[];
  focusTopic?: { key: string; nonce: number } | null;
};

/** Distance from the end that still counts as "at the end", and that shows "Scroll to latest" (§4.2.2). */
const NEAR_END_PX = 80;
const LATEST_PX = 450;

function useFollow(signature: string) {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [distance, setDistance] = useState(0);
  const atEnd = useRef(true);
  useEffect(() => {
    if (atEnd.current) end.current?.scrollIntoView({ block: "end" });
  }, [signature]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    atEnd.current = d < NEAR_END_PX;
    setDistance(d);
  };
  const toEnd = () => end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  return { scroller, end, onScroll, showLatest: distance > LATEST_PX, toEnd };
}

/** Ctrl Enter allows once, Ctrl Shift Enter always allows, Ctrl D says no, on the first waiting card (§4.2.3 Keyboard);
 *  Ctrl Enter in a message box holding a draft sends it instead (approvalKeyFor). */
function useApprovalKeys(first: Approval | null, answer: (id: string, d: ApprovalDecision) => void) {
  useEffect(() => {
    if (!first) return;
    const onKey = (e: KeyboardEvent) => {
      const decision = approvalKeyFor(e);
      if (decision) {
        e.preventDefault();
        answer(first.id, decision);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, answer]);
}

function pendingExtras(details: Map<string, ApprovalDetails>, shown: Set<string>, sessionKey?: string | null): Approval[] {
  return [...details.values()]
    .filter((d) => !d.decision && !shown.has(d.id) && (!d.sessionKey || d.sessionKey === sessionKey) && (!d.expiresAtMs || d.expiresAtMs > Date.now()))
    .map((d) => ({ id: d.id, command: d.command ?? "", cwd: d.cwd, host: d.host, state: "pending" }));
}

/** The thread (DESIGN-SPEC §4.2.2): history from the engine, then the run that is going now. */
export function Thread(props: Props) {
  const { name, history, live, pendingUser, running, engine, onToast } = props;
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);
  const prefs = useConversationPrefs(engine);
  const prefKey = JSON.stringify(prefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx: ThreadContextValue = useMemo(() => ({ engine, sessionKey: props.sessionKey, name, toast, running, prefs }), [engine, props.sessionKey, name, toast, running, prefKey]);
  const { details } = useApprovalDetails(engine);
  const { reactions, apply } = useReactions(engine, history.length);
  const { helpers } = useHelpers(engine);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => [...history, ...(running ? live : [])], [history, live, running]);
  const extras = pendingExtras(details, shownApprovalIds(all), engine?.sessionKey);
  const answer = useCallback(
    (id: string, decision: ApprovalDecision) => {
      const plugin = details.get(id)?.plugin ?? false;
      if (engine && (decision === "allow-always" || plugin)) resolveApproval(engine, id, decision, plugin).catch((e: unknown) => toast(e instanceof Error ? e.message : String(e)));
      else if (decision !== "allow-always") props.onAnswer(id, decision);
    },
    [details, engine, props, toast],
  );
  const allApprovals = [...all.filter((b) => b.kind === "approval").map((b) => (b as Extract<Block, { kind: "approval" }>).approval), ...extras];
  const firstPending = allApprovals.find((a) => a.state === "pending") ?? null;
  // Exactly two waiting: one "Two things need you" card with Yes to both, in place of the two cards.
  const waitingTwo = allApprovals.filter((a) => a.state === "pending");
  const grouped = useMemo(() => new Set(waitingTwo.length === 2 ? waitingTwo.map((a) => a.id) : []), [waitingTwo.map((a) => a.id).join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps
  useApprovalKeys(firstPending, answer);
  const { actionsFor, dialog } = useMessageActions(ctx, { onReload: props.onReload, onOpenSession: props.onOpenSession, onReply: props.onReply, applyReaction: apply });
  const liveText = live.reduce((n, b) => n + (b.kind === "text" || b.kind === "thinking" ? b.text.length : 1), 0);
  const signature = `${history.length}:${live.length}:${liveText}:${pendingUser ? 1 : 0}:${running ? 1 : 0}:${extras.length}`;
  const follow = useFollow(signature);
  const [finding, setFinding] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  useFindKey(useCallback(() => setFinding(true), []));
  const empty = !history.length && !pendingUser && !running && !props.questions?.length;
  const anchors = anchorQuestions(history, props.questions ?? []);
  const items: RoomItem[] = props.room ? foldTalks(layout(history), props.room.ownAgentId) : layout(history);
  const planWanted = props.plan ? planAnchor(history) : -1;
  const planAt = items.some((i) => i.type === "block" && i.index === planWanted) ? planWanted : -1;
  const lastUser = history.map((b) => b.kind).lastIndexOf("user");
  const stamps = useMemo(() => dayStamps(history), [history]);
  const topicEvents = new Map<number, { at: number; node: ReactNode }[]>();
  for (const update of props.topicUpdates ?? []) {
    const add = (position: number, at: number, node: ReactNode) => topicEvents.set(position, [...(topicEvents.get(position) ?? []), { at, node }]);
    add(topicPosition(history, update.topic.anchor?.at ?? update.at, update.topic.anchor?.afterMessageId), update.topic.anchor?.at ?? update.at,
      <TopicOrigin key={`origin:${update.topic.key}`} topic={update.topic} onOpen={(key) => props.onOpenSession?.(key)} />);
    add(topicPosition(history, update.at), update.at,
      <TopicCard key={`update:${update.topic.key}`} update={update} onOpen={(key) => props.onOpenSession?.(key)} />);
  }
  const renderTopicEvents = (position: number) => topicEvents.get(position)?.sort((a, b) => a.at - b.at).map((event) => event.node);
  useEffect(() => {
    if (!props.focusTopic) return;
    const target = [...threadRef.current?.querySelectorAll<HTMLElement>("[data-testid]") ?? []]
      .find((node) => node.dataset.testid === `topic-card-${props.focusTopic?.key}`);
    target?.scrollIntoView({ block: "end" });
  }, [props.focusTopic, props.topicUpdates]);
  const view = { all, actionsFor, reactions, apply, details, answer, dismissed, setDismissed, name, running, live, times: prefs.messageTimes, grouped, room: props.room, lastUser };
  return (
    <ThreadContext.Provider value={ctx}>
      <div className="thread-wrap" data-times={prefs.messageTimes} data-look={prefs.msgLook} data-scrollbars={prefs.scroll} dir={prefs.dir}>
      {finding ? <FindBar root={threadRef} name={name} signature={signature} onClose={() => setFinding(false)} /> : null}
      <div className="scroll" ref={follow.scroller} onScroll={follow.onScroll} data-testid="thread-scroll">
        <div className="thread" ref={threadRef}>
          {empty ? <EmptyState onOpenSession={props.onOpenSession} onStart={props.onStart} /> : null}
          {renderTopicEvents(-1)}
          {items.map((item) =>
            item.type === "talk" ? (
              <Fragment key={item.key}>
                <div className="blk" data-block-key={item.lines[0]?.key} data-block-keys={item.lines.map((l) => l.key).join(" ")}>
                  <TalkedFold talk={item} ownName={name} trunkName={props.room?.trunkName ?? ((id: string) => id)} />
                </div>
                {renderTopicEvents(history.findIndex((block) => block.key === item.lines.at(-1)?.key))}
              </Fragment>
            ) : (
              <Fragment key={keyOf(item)}>
                {item.type === "block" && stamps.has(item.index) ? <div className="stamp" data-testid="day-stamp">{stamps.get(item.index)}</div> : null}
                <ItemWithQuestions item={item} view={view} asked={item.type === "block" ? anchors.get(item.index) : undefined} plan={item.type === "block" && item.index === planAt ? props.plan : null} />
                {renderTopicEvents(item.type === "block" ? item.index : history.findIndex((block) => block.key === item.steps.at(-1)?.key))}
              </Fragment>
            ),
          )}
          {props.room ? <RoomLine history={history} room={props.room} ownName={name} /> : null}
          {pendingUser ? <UserMessage block={{ kind: "user", key: "pending", text: pendingUser }} /> : null}
          {running ? <LiveRun view={view} offset={history.length} /> : null}
          {(anchors.get(-1) ?? []).map((r) => <QuestionLine key={r.id} record={r} />)}
          {extras.filter((a) => !grouped.has(a.id)).map((a) => <ApprovalCard key={a.id} approval={a} details={details.get(a.id)} name={name} onAnswer={answer} />)}
          {grouped.size === 2 ? <ApprovalGroup approvals={waitingTwo} details={details} name={name} onAnswer={answer} /> : null}
          {helpers.length && engine?.sessionKey ? (
            <HelpersChip helpers={helpers} approvals={[...details.values()]} root={engine.sessionKey} onAnswer={answer} onOpenSession={props.onOpenSession} onOpenActivity={props.onOpenActivity}
              onStop={(h) => engine.request("sessions.abort", { key: h.key }).then(() => toast(`Stopped ${h.name}. ${name} carries on without it.`), (e: unknown) => toast(e instanceof Error ? e.message : String(e)))} />
          ) : null}
          {props.supplement}
          {planAt < 0 ? props.plan : null}
          <div ref={follow.end} className="thread-end" />
        </div>
      </div>
      <Rail scroller={follow.scroller} blocks={all} />
      {follow.showLatest ? (
        <button type="button" className="to-latest" aria-label="Scroll to latest" title="Scroll to latest" onClick={follow.toEnd}>
          <Icon d={ICONS.down} size={16} />
        </button>
      ) : null}
      {props.room?.isRoom ? null : <DoneCheer name={name} running={running} history={history} />}
      </div>
      {dialog}
    </ThreadContext.Provider>
  );
}

type View = {
  all: Block[];
  live: Block[];
  actionsFor: ReturnType<typeof useMessageActions>["actionsFor"];
  reactions: ReturnType<typeof useReactions>["reactions"];
  apply: (id: string, raw: unknown) => void;
  details: Map<string, ApprovalDetails>;
  answer: (id: string, d: ApprovalDecision) => void;
  dismissed: Set<string>;
  setDismissed: (fn: (s: Set<string>) => Set<string>) => void;
  name: string;
  running: boolean;
  times: "hover" | "always" | "never";
  /** Approvals shown together in the "Two things need you" card instead of on their own. */
  grouped: Set<string>;
  room?: ThreadRoom;
  /** The last message you sent in the history; the replies after it belong to the turn that is running. */
  lastUser: number;
};

/** A day stamp over the first message of each day that has a recorded time (§4.2.2 Stamp). */
function dayStamps(history: readonly Block[]): Map<number, string> {
  const out = new Map<number, string>();
  let day = "";
  history.forEach((b, i) => {
    const at = b.kind === "user" || b.kind === "text" ? b.meta?.timestamp : undefined;
    if (!at) return;
    const d = new Date(at).toDateString();
    if (d !== day) out.set(i, dayStamp(at));
    day = d;
  });
  return out;
}

/** "Message times: Always" (§4.7.1): the time (and, on a reply, the model) under each message. */
function TimeLine({ block, view }: { block: Extract<Block, { kind: "user" | "text" }>; view: View }) {
  const at = block.meta?.timestamp;
  if (view.times !== "always" || !at) return null;
  const model = block.kind === "text" ? modelName(block.meta?.model) : "";
  return (
    <div className={block.kind === "user" ? "msg-time mine" : "msg-time theirs"} title={fullTime(at)}>
      {model ? `${messageTime(at)} · ${model}` : messageTime(at)}
    </div>
  );
}

function keyOf(item: Item): string {
  return item.type === "steps" ? item.key : item.block.key;
}

/** The run that is going now, from its first event until it ends (`data-streaming="true"`). */
function LiveRun({ view, offset }: { view: View; offset: number }) {
  const { live, name } = view;
  const waiting = live.some((b) => b.kind === "approval" && b.approval.state === "pending");
  const status = live.find((b): b is Extract<Block, { kind: "status" }> => b.kind === "status") ?? null;
  const typing = !waiting && !live.some((b) => b.kind === "text" || b.kind === "thinking" || b.kind === "step");
  return (
    <div className="live-run" data-streaming="true">
      {layout(live.filter((b) => b.kind !== "status"), offset).map((item) => <ItemView key={keyOf(item)} item={item} view={view} live />)}
      {typing ? <Typing name={name} status={status} /> : null}
    </div>
  );
}

function ItemWithQuestions({ item, view, asked, plan }: { item: Item; view: View; asked?: QuestionRecord[]; plan?: ReactNode }) {
  return (
    <>
      <ItemView item={item} view={view} live={false} />
      {asked?.map((r) => <QuestionLine key={r.id} record={r} />)}
      {plan}
    </>
  );
}

/** Each item carries its block key (a steps fold carries every step's), so other parts of the window can find it:
 *  `[data-block-key="<key>"]`, or `[data-block-keys~="<step key>"]` for a step. The wrapper takes no space
 *  (display: contents); scroll to its first child. */
function ItemView(props: { item: Item; view: View; live: boolean }) {
  const { item } = props;
  const keys = item.type === "steps" ? item.steps.map((s) => s.key) : [item.block.key];
  return (
    <div className="blk" data-block-key={keys[0]} data-block-keys={keys.join(" ")}>
      <ItemBody {...props} />
    </div>
  );
}

function ItemBody({ item, view, live }: { item: Item; view: View; live: boolean }) {
  if (item.type === "steps") {
    if (!item.face) return <StepsFold steps={item.steps} live={live} run={item.run} />;
    return (
      <div className="msg reply steps-turn">
        <span className="gutter"><span className={view.running && live ? "gutter-face working-ring" : "gutter-face"}>{faceFor(view, live)}</span></span>
        <StepsFold steps={item.steps} live={live} run={item.run} />
      </div>
    );
  }
  const { block, index, firstReply, face } = item;
  switch (block.kind) {
    case "user":
    case "text":
      return <MessageView block={block} index={index} firstReply={firstReply} face={face} view={view} live={live} />;
    case "thinking":
      return <Thinking block={block} />;
    case "approval":
      return view.grouped.has(block.approval.id) ? null : <ApprovalCard approval={block.approval} details={view.details.get(block.approval.id)} name={view.name} onAnswer={view.answer} />;
    case "done":
      return <DoneLine block={block} name={view.name} />;
    case "error":
      return view.dismissed.has(block.key) ? null : <ErrorBlock block={block} onDismiss={() => view.setDismissed((s) => new Set(s).add(block.key))} />;
    case "notice":
      return <Notice block={block} />;
    default:
      return null;
  }
}

function faceFor(view: View, live: boolean): ReactNode {
  const state = live ? agentState({ live: view.live, running: view.running, history: [], endedAt: null, now: Date.now() }) : "idle";
  return <Face size={28} label={view.name} state={state} priority={live ? PRIORITY.open : PRIORITY.row} />;
}

function MessageView({ block, index, firstReply, face, view, live }: { block: Extract<Block, { kind: "user" | "text" }>; index: number; firstReply: boolean; face: boolean; view: View; live: boolean }) {
  const actions = live ? null : view.actionsFor(view.all, index);
  const entryId = block.meta?.entryId;
  const chips = entryId ? view.reactions.get(entryId) ?? [] : [];
  const bar = actions ? <HoverBar isReply={block.kind === "text"} actions={actions} meta={block.meta} /> : null;
  const toggle = (emoji: string, remove: boolean) => {
    if (actions && !actions.reactDisabled) actions.react(emoji, remove);
  };
  if (block.kind === "user") {
    const other = otherSender(block, view.room);
    return (
      <>
        {other ? (
          <RoomMessage sender={other} text={block.text} attachments={block.attachments} entryId={block.meta?.entryId} where={other.kind === "agent" ? view.room?.whereRuns(other.id) : null}>{bar}</RoomMessage>
        ) : (
          <UserMessage block={block}>{bar}</UserMessage>
        )}
        <TimeLine block={block} view={view} />
        <ReactionChips list={chips} onToggle={toggle} />
      </>
    );
  }
  return (
    <>
      <Reply block={block} face={face ? faceFor(view, live) : undefined} working={face && view.running && (live || index > view.lastUser)} from={fromName(block, firstReply, view.room, view.name)}>{bar}</Reply>
      {live ? null : <TimeLine block={block} view={view} />}
      <ReactionChips list={chips} onToggle={toggle} />
    </>
  );
}
