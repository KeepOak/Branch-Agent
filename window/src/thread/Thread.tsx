import { Children, cloneElement, Fragment, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { agentState } from "../face/agentState";
import { PRIORITY } from "../face/cap";
import { resolveApproval } from "./actions";
import { ApprovalCard, ApprovalGroup } from "./ApprovalCard";
import { lockdownAllowsAnswer } from "./approval-guard";
import { DoneLine, ErrorBlock, Notice, Reply, SteeredNote, StepsFold, Thinking, Typing, UserMessage } from "./blocks";
import { ThreadContext, type ThreadContextValue } from "./context";
import { ReactionChips } from "./dialogs";
import { DoneCheer } from "./DoneCheer";
import { EmptyState } from "./EmptyState";
import { FindBar, useFindKey } from "./FindBar";
import { HelpersChip } from "./Helpers";
import { HoverBar } from "./HoverBar";
import { Rail } from "./Rail";
import { Icon, ICONS } from "./icons";
import { ComputerActivityCard } from "./ComputerActivityCard";
import { turnDoneLines } from "./computer-card";
import { isComputerStep, layout, shownApprovalIds, type Item } from "./layout";
import { isInternalStep } from "./internal-steps";
import { PlanCard, planAnchor } from "./PlanCard";
import { TeamProposalBlock } from "./TeamProposalBlock";
import { useConversationPrefs } from "./prefs";
import { isPreparationPending, isPreparationStalled, preparationLabel, preparationNeedsAttentionLabel, preparationRetryingLabel } from "../connect/preparation-status";
import { useStartupPreparation } from "../connect/startup-preparation";
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
import { QueuedMessages, useOwnWaitingLine } from "./QueuedMessages";
import type { QueuedMessage, RunEnd, SteeredNote as Steered } from "../connect/session";
import { dayStamp, formatDuration, fullTime, messageTime, modelName, stepLabel } from "./format";
import { TopicCard, TopicOrigin, topicPosition, type TopicUpdate } from "./TopicCard";
import { suggestionsFor } from "./suggestions";
import type { EarlierPage } from "../shell/useContactSegments";
import { useScrollMemory } from "../places-nav/scroll-memory";

type Props = {
  lockdown?: boolean;
  supplement?: ReactNode;
  onOpenActivity?: () => void;
  name: string;
  history: Block[];
  /**
   * False while this conversation's transcript has not been read. Omitted means the
   * caller already knows the history, so an empty list is still a new conversation.
   */
  historyReady?: boolean;
  live: Block[];
  pendingUser: string | null;
  /** Messages accepted but waiting for a turn (connect/session.ts queued). */
  queued?: QueuedMessage[];
  /** What you told the running turn (steered), shown as notes under it until the turn ends. */
  steered?: Steered[];
  running: boolean;
  /** When the live run started (engine time); the "Working" clock counts from it. */
  liveStartedAt?: number | null;
  showThinking?: boolean;
  onAnswer: (id: string, decision: "allow-once" | "deny") => void;
  /** The shared engine handle (connect/engine.ts); without it the message actions stay greyed with their reason. */
  engine?: WindowEngine;
  sessionKey?: string | null;
  /** Reads the conversation's history again (after a rewind or a resend). */
  onReload?: () => void;
  onToast?: (text: string) => void;
  onOpenSession?: (key: string) => void;
  onReply?: (target: ReplyTarget) => void;
  onStartTopic?: (afterMessageId: string) => void;
  /** The conversation's questions (question.list); the waiting one is answered above the message box. */
  questions?: QuestionRecord[];
  /** Sends a starter from the empty conversation (§4.2.9), the same way the composer sends. */
  onStart?: (text: string) => void;
  /** How the last run ended; the done cheer plays only for one that finished. */
  ended?: RunEnd | null;
  /** The conversation's last run error (sessions.list lastRunError); restart recovery's own one shows "Stopped by restart". */
  recoveryFailure?: string;
  /** The Plan card; it goes after the turn that last updated it (planAnchor), else at the end (§4.2.2). */
  plan?: ReactNode;
  /** Who else writes here (rooms/): other people, outside agents and other Trunks (§4.2.4). */
  room?: ThreadRoom;
  topicUpdates?: TopicUpdate[];
  focusTopic?: { key: string; nonce: number } | null;
  /** A sidebar message search asks this conversation to find the same words after navigation. */
  findRequest?: { query: string; nonce: number } | null;
  onFindRequestHandled?: (nonce: number) => void;
  earlierPages?: EarlierPage[];
  currentStartedAt?: number;
  hasEarlierPages?: boolean;
  loadingEarlier?: boolean;
  earlierError?: string;
  preparationError?: string | null;
  /** The Trunk got ready after this conversation stopped waiting for it: read the conversation again. */
  onStartupReady?: () => void;
  advancedDiagnostics?: boolean;
  onLoadEarlier?: () => void;
};

/** Watch/Take over props from the shell's pinned card, so each in-turn card can open the stage. */
function computerCardProps(node: ReactNode): ComponentProps<typeof ComputerActivityCard> | undefined {
  if (!isValidElement(node)) return undefined;
  if (node.type === ComputerActivityCard) return node.props as ComponentProps<typeof ComputerActivityCard>;
  const children = (node.props as { children?: ReactNode }).children;
  let found: ComponentProps<typeof ComputerActivityCard> | undefined;
  Children.forEach(children, (child) => {
    found ??= computerCardProps(child);
  });
  return found;
}

/** Drops the conversation-wide computer card so it is not pinned under later replies. */
function dropComputerCard(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  if (node.type === ComputerActivityCard) return null;
  const children = (node.props as { children?: ReactNode }).children;
  if (children == null) return node;
  return cloneElement(node as ReactElement<{ children?: ReactNode }>, undefined, Children.map(children, dropComputerCard));
}

/** The lastRunError the engine's restart recovery records when it could not carry a run on
 * (engine main-session-restart-recovery-store.ts tombstoneMainRestartRecoveryWithNotice). */
const RESTART_NOT_RESUMED = "Interrupted by a restart. Continue?";
const NEAR_END_PX = 80;
const LATEST_PX = 450;

/** `sent` lists what you just sent (your message over the turn, a steer, the newest waiting one). When one of them
 *  becomes something new, the thread jumps to the latest message even if you had scrolled up (owner decision 7,
 *  2026-10-06); everyone else's blocks keep your place. */
function useFollow(signature: string, sent: readonly (string | null | undefined)[]) {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const distance = useRef(0);
  const [showLatest, setShowLatest] = useState(false);
  const atEnd = useRef(true);
  useScrollMemory(scroller, { atEnd });
  const lastSent = useRef(sent);
  const sentKey = sent.join("\u0000");
  useEffect(() => {
    const before = lastSent.current;
    lastSent.current = sent;
    if (sent.some((value, i) => value && value !== before[i])) atEnd.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentKey]);
  useEffect(() => {
    if (!atEnd.current) return;
    const id = requestAnimationFrame(() => {
      const el = scroller.current;
      if (atEnd.current && el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [signature, sentKey]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    atEnd.current = d < NEAR_END_PX;
    distance.current = d;
    const latest = d > LATEST_PX;
    setShowLatest((open) => (open === latest ? open : latest));
  };
  const toEnd = () => end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  return { scroller, end, onScroll, showLatest, toEnd };
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
  const ownLine = useOwnWaitingLine(props.sessionKey ?? engine?.sessionKey);
  // A message from this window's waiting line that a turn picked up: its bubble says "Delivered" until history has it.
  const lineTexts = useRef(new Set<string>());
  for (const item of ownLine) lineTexts.current.add(item.text);
  const pendingDelivered = pendingUser !== null && lineTexts.current.has(pendingUser);
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);
  const prefs = useConversationPrefs(engine);
  const prefKey = JSON.stringify(prefs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ctx: ThreadContextValue = useMemo(() => ({ engine, sessionKey: props.sessionKey, name, toast, running, prefs }), [engine, props.sessionKey, name, toast, running, prefKey]);
  const { details } = useApprovalDetails(engine);
  const { reactions, apply } = useReactions(engine, history.length);
  const { helpers } = useHelpers(engine);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [usedSuggestion, setUsedSuggestion] = useState<string | null>(null);
  const all = useMemo(() => [...history, ...(running ? live : [])], [history, live, running]);
  const extras = pendingExtras(details, shownApprovalIds(all), engine?.sessionKey);
  const answer = useCallback(
    (id: string, decision: ApprovalDecision) => {
      if (!lockdownAllowsAnswer(props.lockdown, decision)) return;
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
  const { actionsFor, dialog } = useMessageActions(ctx, { onReload: props.onReload, onOpenSession: props.onOpenSession, onReply: props.onReply, onStartTopic: props.onStartTopic, applyReaction: apply });
  const liveText = live.reduce((n, b) => n + (b.kind === "text" || b.kind === "thinking" ? b.text.length : 1), 0);
  const waitingCount = (props.queued?.length ?? 0) + ownLine.length;
  const signature = `${history.length}:${live.length}:${liveText}:${pendingUser ? 1 : 0}:${running ? 1 : 0}:${extras.length}:${waitingCount}`;
  const follow = useFollow(signature, [pendingUser, props.steered?.at(-1)?.runId, ownLine.at(-1)?.id]);
  const [finding, setFinding] = useState(false);
  const [findRequest, setFindRequest] = useState({ query: "", nonce: 0 });
  const threadRef = useRef<HTMLDivElement>(null);
  useFindKey(useCallback((query?: string) => {
    setFinding(true);
    if (query) setFindRequest((current) => ({ query, nonce: current.nonce + 1 }));
  }, []));
  useEffect(() => {
    if (!props.findRequest) return;
    setFinding(true);
    const query = props.findRequest.query;
    // Always remount the Find bar: the shell's nonce and this thread's own Ctrl+F count separately and can collide.
    setFindRequest((current) => ({ query, nonce: current.nonce + 1 }));
    props.onFindRequestHandled?.(props.findRequest.nonce);
  }, [props.findRequest?.nonce]);
  const historyReady = props.historyReady !== false;
  const empty = historyReady && !history.length && !pendingUser && !running && !props.questions?.length && !waitingCount;
  const lastReply = [...history].reverse().find((block) => block.kind === "text");
  const suggestionKey = lastReply ? `${props.sessionKey ?? ""}:${lastReply.key}` : null;
  const suggestions = props.onStart && !firstPending && suggestionKey !== usedSuggestion
    ? suggestionsFor(history, running, Boolean(pendingUser)) : [];
  const preparationError = [props.preparationError, props.earlierError].find((error) => isPreparationPending(error) || isPreparationStalled(error));
  const startup = useStartupPreparation(engine, Boolean(preparationError), isPreparationStalled(preparationError), props.onStartupReady);
  const inRoom = Boolean(props.room);
  const ownAgentId = props.room?.ownAgentId;
  const anchors = useMemo(() => anchorQuestions(history, props.questions ?? []), [history, props.questions]);
  const items = useMemo<RoomItem[]>(
    () => (inRoom ? foldTalks(layout(history), ownAgentId) : layout(history)),
    [history, inRoom, ownAgentId],
  );
  const helperStartedAt = Math.min(...helpers.map((h) => h.createdAt ?? Number.POSITIVE_INFINITY));
  const helperUserAt = Number.isFinite(helperStartedAt) ? history.findLastIndex((b) => b.kind === "user" && typeof b.meta?.timestamp === "number" && b.meta.timestamp <= helperStartedAt) : -1;
  const helperNextUserAt = helperUserAt < 0 ? -1 : history.findIndex((b, i) => i > helperUserAt && b.kind === "user");
  const planWanted = props.plan ? planAnchor(history) : -1;
  const planAt = items.some((i) => i.type === "block" && i.index === planWanted) ? planWanted : -1;
  const lastUser = history.map((b) => b.kind).lastIndexOf("user");
  const stamps = useMemo(() => dayStamps(history), [history]);
  const helperChip = helpers.length && engine?.sessionKey ? (
    <HelpersChip helpers={helpers} approvals={[...details.values()]} root={engine.sessionKey} onAnswer={answer} onOpenSession={props.onOpenSession} onOpenActivity={props.onOpenActivity}
      onStop={(h) => engine.request("sessions.abort", { key: h.key }).then(() => toast(`Stopped ${h.name}. ${name} carries on without it.`), (e: unknown) => toast(e instanceof Error ? e.message : String(e)))} />
  ) : null;
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
  const activity = computerCardProps(props.supplement);
  const restSupplement = dropComputerCard(props.supplement);
  const view = { all, actionsFor, reactions, apply, details, answer, dismissed, setDismissed, name, running, live, times: prefs.messageTimes, grouped, room: props.room, lastUser, showThinking: props.showThinking !== false, liveStartedAt: props.liveStartedAt ?? null, lockdown: props.lockdown, onOpenSession: props.onOpenSession, engine, onWatchComputer: activity?.onWatch ?? (() => undefined), gatewayUrl: activity?.gatewayUrl ?? engine?.gatewayUrl };
  const recoveryEntryId = history.findLast((block) =>
    (block.kind === "user" || block.kind === "text") && Boolean(block.meta?.entryId),
  );
  const continueInterrupted = async () => {
    if (!engine?.sessionKey || !recoveryEntryId || (recoveryEntryId.kind !== "user" && recoveryEntryId.kind !== "text") || !recoveryEntryId.meta?.entryId) return;
    try {
      const result = await engine.request<{ sessionKey?: string }>("sessions.fork", {
        sessionKey: engine.sessionKey,
        entryId: recoveryEntryId.meta.entryId,
      });
      if (!result.sessionKey) throw new Error("The recovered conversation was not created.");
      await engine.request("chat.send", {
        sessionKey: result.sessionKey,
        message: "Continue the task interrupted by the restart from the transcript above.",
        idempotencyKey: crypto.randomUUID(),
      });
      props.onOpenSession?.(result.sessionKey);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <ThreadContext.Provider value={ctx}>
      <div className="thread-wrap" data-times={prefs.messageTimes} data-look={prefs.msgLook} data-scrollbars={prefs.scroll} dir={prefs.dir}>
      {finding ? <FindBar key={findRequest.nonce} root={threadRef} name={name} signature={signature} initialQuery={findRequest.query} onClose={() => { setFinding(false); setFindRequest((current) => ({ query: "", nonce: current.nonce + 1 })); }} /> : null}
      <div className="scroll" ref={follow.scroller} tabIndex={-1} onScroll={(event) => { follow.onScroll(); if (event.currentTarget.scrollTop < 80 && props.hasEarlierPages && !props.loadingEarlier) props.onLoadEarlier?.(); }} data-testid="thread-scroll">
        <div className="thread" ref={threadRef}>
          {props.hasEarlierPages ? <button type="button" className="stamp segment-more" onClick={props.onLoadEarlier} disabled={props.loadingEarlier}>{props.loadingEarlier ? "Loading earlier pages…" : "Earlier pages"}</button> : null}
          {preparationError ? <div className="stamp preparation-status" role="status" data-testid="preparation-status">
            {startup.state !== "needs-attention" ? <span className="preparation-spinner" aria-hidden="true" /> : null}
            {startup.state === "needs-attention" ? preparationNeedsAttentionLabel(name) : startup.state === "retrying" ? preparationRetryingLabel(name) : isPreparationStalled(preparationError) ? preparationError : preparationLabel(name)}
            {startup.state !== "preparing" ? <button type="button" className="btn sm" disabled={startup.busy} onClick={startup.retry}>{startup.busy ? "Retrying…" : startup.state === "needs-attention" ? "Retry" : "Retry now"}</button> : null}
            {startup.error ? <span role="alert">Couldn't retry: {startup.error}</span> : null}
            {props.advancedDiagnostics ? <details><summary>Diagnostics</summary><code>{preparationError}</code></details> : null}
          </div> : null}
          {props.earlierError && !isPreparationPending(props.earlierError) ? <div className="stamp" role="status">Couldn't load earlier pages: {props.earlierError}</div> : null}
          {[...(props.earlierPages ?? [])].reverse().map((page) => <div key={page.sessionId} className="segment-page" aria-label="Earlier conversation segment">
            <div className="stamp">New start · {page.startedAt ? new Date(page.startedAt).toLocaleDateString() : "Earlier"}</div>
            {page.blocks.filter((block) => ["user", "text", "thinking", "step", "notice", "error"].includes(block.kind)).map((block) => <div key={block.key} className="segment-line">
              <strong>{block.kind === "user" ? "You" : block.kind === "text" ? name : block.kind === "step" ? stepLabel(block) : "Activity"}</strong>
              <span>{block.kind === "user" || block.kind === "text" || block.kind === "thinking" || block.kind === "notice" ? block.text : block.kind === "step" ? [block.title, block.detail].filter(Boolean).join(" · ") : block.kind === "error" ? isPreparationPending(block.message) ? "Branch retried a startup delay." : block.message : block.kind === "status" ? block.phase : block.kind === "approval" ? block.approval.command : ""}</span>
            </div>)}
          </div>)}
          {(props.earlierPages?.length || props.hasEarlierPages) ? <div className="stamp">New start · {props.currentStartedAt ? new Date(props.currentStartedAt).toLocaleDateString() : "Current"}</div> : null}
          {empty ? <EmptyState onOpenSession={props.onOpenSession} onStart={props.onStart} /> : !historyReady && !history.length && !props.preparationError ? (
            <div className="stamp preparation-status" role="status" data-testid="thread-opening">
              <span className="preparation-spinner" aria-hidden="true" />
              Opening this conversation…
            </div>
          ) : null}
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
                {item.type === "block" && item.index === helperNextUserAt ? helperChip : null}
                {item.type === "block" && stamps.has(item.index) ? <div className="stamp" data-testid="day-stamp">{stamps.get(item.index)}</div> : null}
                <ItemWithQuestions item={item} view={view} asked={item.type === "block" ? anchors.get(item.index) : undefined} plan={item.type === "block" && item.index === planAt ? props.plan : null} />
                {renderTopicEvents(item.type === "block" ? item.index : history.findIndex((block) => block.key === item.steps.at(-1)?.key))}
              </Fragment>
            ),
          )}
          {props.room ? <RoomLine history={history} room={props.room} ownName={name} /> : null}
          {pendingUser ? (
            pendingDelivered ? (
              <div className="queued-msg delivered" data-testid="queued-message" data-state="delivered">
                <UserMessage block={{ kind: "user", key: "pending", text: pendingUser }} />
                <span className="queue-mark mine">Delivered</span>
              </div>
            ) : (
              <UserMessage block={{ kind: "user", key: "pending", text: pendingUser }} />
            )
          ) : null}
          <QueuedMessages queued={props.queued ?? []} own={ownLine} room={props.room} part="delivered" />
          {running ? <LiveRun view={view} offset={history.length} /> : null}
          {running ? (props.steered ?? []).map((note) => <SteeredNote key={note.runId} name={name} text={note.text} />) : null}
          <QueuedMessages queued={props.queued ?? []} own={ownLine} room={props.room} part="waiting" sessionKey={props.sessionKey ?? engine?.sessionKey ?? undefined} />
          {(anchors.get(-1) ?? []).map((r) => <QuestionLine key={r.id} record={r} />)}
          {extras.filter((a) => !grouped.has(a.id)).map((a) => <ApprovalCard key={a.id} approval={a} details={details.get(a.id)} name={name} onAnswer={answer} disabled={props.lockdown} />)}
          {grouped.size === 2 ? <ApprovalGroup approvals={waitingTwo} details={details} name={name} onAnswer={answer} disabled={props.lockdown} /> : null}
          {helperNextUserAt < 0 ? helperChip : null}
          {restSupplement}
          {suggestions.length ? <div className="suggestion-row" role="group" aria-label="Suggested replies" data-testid="suggestion-row">
            {suggestions.map((text) => <button key={text} type="button" title={`Send “${text}” as your reply`} aria-label={`Reply: ${text}`} onClick={() => { setUsedSuggestion(suggestionKey); props.onStart?.(text); }}><Icon d={ICONS.reply} size={12} className="sug-arrow" />{text}</button>)}
          </div> : null}
          {props.recoveryFailure === RESTART_NOT_RESUMED ? (
            <div className="pass-line restart-stop" role="status" data-testid="restart-stopped">Stopped by restart{recoveryEntryId ? <button type="button" className="btn pri sm" onClick={() => void continueInterrupted()}>Resume</button> : null}</div>
          ) : null}
          {planAt < 0 ? props.plan : null}
          <div ref={follow.end} className="thread-end" />
        </div>
      </div>
      <Rail scroller={follow.scroller} blocks={all} sessionKey={props.sessionKey} />
      {follow.showLatest ? (
        <button type="button" className="to-latest" aria-label="Scroll to latest" title="Scroll to latest" onClick={follow.toEnd}>
          <Icon d={ICONS.down} size={16} />
        </button>
      ) : null}
      {props.room?.isRoom ? null : <DoneCheer name={name} ended={props.ended} history={history} />}
      </div>
      {dialog}
    </ThreadContext.Provider>
  );
}

type View = {
  onOpenSession?: (key: string) => void;
  lockdown?: boolean;
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
  showThinking: boolean;
  liveStartedAt: number | null;
  engine?: WindowEngine;
  onWatchComputer: (mode: "Computer" | "Browser", takeOver?: boolean) => void;
  gatewayUrl?: string;
};

function ActivityCard({ steps, view }: { steps: Extract<Block, { kind: "step" }>[]; view: View }) {
  if (!steps.some(isComputerStep)) return null;
  return (
    <ComputerActivityCard
      blocks={[...steps, ...turnDoneLines(steps, view.all)]}
      running={view.running}
      name={view.name}
      engine={view.engine}
      gatewayUrl={view.gatewayUrl}
      onWatch={view.onWatchComputer}
    />
  );
}

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
  const [elapsed, setElapsed] = useState(0);
  const startedAt = view.liveStartedAt;
  useEffect(() => {
    const started = startedAt ?? Date.now();
    const tick = () => setElapsed(Math.max(0, Date.now() - started));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const usage = live.find((b): b is Extract<Block, { kind: "usage" }> => b.kind === "usage");
  const waiting = live.some((b) => b.kind === "approval" && b.approval.state === "pending");
  const typing = !waiting && !live.some((b) => b.kind === "text" || (view.showThinking && b.kind === "thinking") || (b.kind === "step" && !isInternalStep(b)) || b.kind === "preamble" || b.kind === "plan");
  return (
    <div className="live-run" data-streaming="true">
      {/* While only the dots show, nothing sits above them (P47); the clock comes with the first real activity. */}
      {typing ? null : <header className="live-run-head">Working{elapsed >= 1000 ? ` · ${formatDuration(elapsed)}` : ""}{usage?.total ? ` · ${usage.total.toLocaleString()} tokens` : ""}</header>}
      {layout(live.filter((b) => b.kind !== "status"), offset).map((item) => <ItemView key={keyOf(item)} item={item} view={view} live />)}
      {typing ? <Typing name={name} /> : null}
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
    const card = <ActivityCard steps={item.steps} view={view} />;
    if (!item.face) {
      return (
        <>
          <StepsFold steps={item.steps} live={live} run={item.run} />
          {card}
        </>
      );
    }
    return (
      <>
        <div className="msg reply steps-turn">
          <span className="gutter"><span className={view.running && live ? "gutter-face working-ring" : "gutter-face"}>{faceFor(view, live)}</span></span>
          <StepsFold steps={item.steps} live={live} run={item.run} />
        </div>
        {card}
      </>
    );
  }
  const { block, index, firstReply, face } = item;
  switch (block.kind) {
    case "user":
    case "text":
      return <MessageView block={block} index={index} firstReply={firstReply} face={face} view={view} live={live} />;
    case "thinking":
      return view.showThinking ? <Thinking block={block} /> : null;
    case "preamble":
      return <div className="pass-line indent" data-testid="preamble">{block.text}</div>;
    case "plan":
      return <PlanCard card={{ sessionKey: "run", revision: 1, updatedAt: Date.now(), steps: block.steps }} />;
    case "team":
      return <TeamProposalBlock block={block} />;
    case "approval":
      return view.grouped.has(block.approval.id) ? null : <ApprovalCard approval={block.approval} details={view.details.get(block.approval.id)} name={view.name} onAnswer={view.answer} disabled={view.lockdown} />;
    case "done": {
      // The turn up to this line only: what streams after it belongs to the next turn.
      let start = index;
      while (start > 0 && view.all[start - 1].kind !== "user") start -= 1;
      const turn = view.all.slice(start, index);
      // "Done in" closes a task (a turn with steps), not every plain reply (owner decision 5, 2026-10-06).
      if (!block.stopped && !turn.some((entry) => entry.kind === "step" && !isInternalStep(entry))) return null;
      const words = turn.filter((entry): entry is Extract<Block, { kind: "text" }> => entry.kind === "text")
        .reduce((count, entry) => count + (entry.text.trim().match(/\S+/g)?.length ?? 0), 0);
      return <DoneLine block={block} name={view.name} words={words} />;
    }
    case "error":
      if (isPreparationPending(block.message)) return <div className="stamp" role="status">Branch retried a startup delay.</div>;
      return view.dismissed.has(block.key) ? null : <ErrorBlock block={block} onDismiss={() => view.setDismissed((s) => new Set(s).add(block.key))} />;
    case "notice":
      return block.topicKey ? <div className="tpLblT5"><button type="button" onClick={() => view.onOpenSession?.(block.topicKey!)}>{block.text}</button></div> : <Notice block={block} />;
    case "steer":
      return <SteeredNote name={view.name} text={block.text} />;
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
  const putBack = block.meta?.excluded && actions?.context ? <div className="context-line">Left out of context · <button type="button" disabled={Boolean(actions.context.disabled)} title={actions.context.disabled ?? undefined} onClick={actions.context.run}>Put back</button></div> : null;
  const toggle = (emoji: string, remove: boolean) => {
    if (actions && !actions.reactDisabled) actions.react(emoji, remove);
  };
  if (block.kind === "user") {
    const other = otherSender(block, view.room);
    return (
      <>
        {other ? (
          <RoomMessage sender={other} text={block.text} attachments={block.attachments} entryId={block.meta?.entryId} where={other.kind === "agent" ? view.room?.whereRuns(other.id) : null} online={other.kind === "agent" && view.room?.isOnline?.(other.id) === true}>{bar}</RoomMessage>
        ) : (
          <UserMessage block={block}>{bar}</UserMessage>
        )}
        {putBack}
        <TimeLine block={block} view={view} />
        <ReactionChips list={chips} onToggle={toggle} />
      </>
    );
  }
  return (
    <>
      <Reply block={block} face={face ? faceFor(view, live) : undefined} working={face && view.running && (live || index > view.lastUser)} from={fromName(block, firstReply, view.room, view.name)}>{bar}</Reply>
      {putBack}
      {live ? null : <TimeLine block={block} view={view} />}
      <ReactionChips list={chips} onToggle={toggle} />
    </>
  );
}
