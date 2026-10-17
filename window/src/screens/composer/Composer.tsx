// R1-04 Composer (HANDOFF R1-04, preview composeP17): the floating glass pill (+, field, Improve, mic, ring, voice → send),
// the quiet row under it and their menus. The logic is the Classic composer's (composer/*.ts hooks, imported, not
// rewritten); this file only draws it the approved way and joins the parts. Every control is wired or shows Coming.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactElement } from "react";
import type { Conversation as ListRow } from "../../connect/conversations";
import { isPreparationPending, isPreparationStalled, preparationLabel } from "../../connect/preparation-status";
import { PASTED_TEXT_CHIP_CHARS } from "../../composer/attachments";
import { COMPOSE_EVENT } from "../../composer/Composer";
import { folderContext } from "../../composer/context";
import { safeStorage, saveDraft } from "../../composer/drafts";
import { DockRow, type Goal } from "../../composer/DockRow";
import { isAdmin, num, rec, str, type SendExtras, type WindowEngine } from "../../composer/engine";
import { Icon, StopMark } from "../../composer/icons";
import { ConnectModelNotice } from "../../composer/ConnectModelNotice";
import { CONNECT_MODEL_ANSWERS, friendlyModelError, isNoUsableModelError } from "../../composer/connect-model";
import { HistorySearch } from "../../composer/HistorySearch";
import { replaceToken } from "../../composer/mention";
import { isEngineMode, modeName, nextMode, type EngineMode } from "../../composer/mode";
import { currentModelRef, currentThinking } from "../../composer/model";
import type { OpenTarget } from "../../composer/nav";
import { PhotoDialog, PictureDialog } from "../../composer/PhotoDialog";
import { buildExtras, planSend, sendTooltip, type Reply } from "../../composer/sending";
import { newPick, pickText, reconcilePicks, resolveSend, trimMessage, type Message, type SkillPick } from "../../composer/skill-picks";
import { Drawer } from "../../composer/SlashDrawer";
import { useBackground } from "../../composer/useBackground";
import { FREE_MODEL_READY } from "../../composer/no-key-default";
import { hasNoModel, useConversation } from "../../composer/useConversation";
import { useDraft } from "../../composer/useDraft";
import { useDrawer, type Pick } from "../../composer/useDrawer";
import { useHistoryKeys } from "../../composer/useHistoryKeys";
import { useWaitingLine } from "../../composer/useWaitingLine";
import { vimKey, type VimMode } from "../../composer/vim";
import { DictationStrip, TALK_EVENT, useDictation, useVoiceCatalog, useVoiceNote, VoiceNoteStrip, VoiceScreen } from "../../composer/VoiceParts";
import { availability } from "../../connect/capabilities";
import { Coming } from "../../glass/coming";
import { Popover } from "../../glass/Popover";
import { Ring } from "../../glass/Ring";
import type { Limits } from "../../shell/status-data";
import { shortReason } from "../../thread/format";
import { useConversationPrefs } from "../../thread/prefs";
import { improvedText, improvePrompt } from "./improve";
import { PlusMenu } from "./PlusMenu";
import { RingPopover, type RunningRow } from "./RingPopover";
import { Row, type RowMenu } from "./Row";
import { contextUse, ringSummary, tightest } from "./usage";
import "../../composer/composer.css";
import "./composer.css";
import { ComposerPet } from "../pet/ComposerPet";

export const VOICE_OFF = "Off until you choose: it uses the microphone. Turn it on in Settings › Voice.";
/** The mic while dictation has no voice service (Private #1095, B-097): it says so and opens Settings › Voice & calls. */
export const TURN_ON_VOICE = "Turn on voice in Settings";
export const IMPROVE_COMING = "This engine can’t improve a draft with your model.";
/** Improve asks the side model about the draft, not the conversation's Trunk. */
export const IMPROVE_NEED = "sessions.companion.ask";

/** A control this window doesn't wire yet (R1-10): drawn through <Coming> with the engine call it waits for, so it is
 *  greyed with its reason as the tooltip, the click swallowed, and listed in the dev Coming report by method. `hidden` is
 *  the + menu's exception: not drawn, still listed. */
export function Later({ need, reason, where, hidden, children }: { need: string | readonly string[]; reason: string; where: string; hidden?: boolean; children?: ReactElement }) {
  return <Coming need={need} unwired hidden={hidden} reason={reason} where={where}>{children ?? <span />}</Coming>;
}

export type TopicRow = { key: string; title: string };

type Props = {
  name: string;
  engine: WindowEngine;
  working: boolean;
  /** No connection: nothing can be sent, and Send says why. */
  offline: boolean;
  onSend: (text: string, extras?: SendExtras, idempotencyKey?: string) => void | Promise<boolean>;
  onStop: () => void;
  onToast: (text: string) => void;
  onOpen: (target: OpenTarget) => void;
  onOpenConversation: (key: string) => void;
  /** usage.status, read by the window once for the status ring and every surface (shell/use-status useLimits). */
  limits: Limits | null;
  /** This conversation's sessions.list row: its room (totalTokens / contextTokens) and whether it is the Main chat. */
  row?: ListRow;
  /** This Trunk's other open conversations, for "to …" in its Main chat. */
  topics: TopicRow[];
  /** Everything working now, from sessions.list. */
  running: RunningRow[];
  mainKey?: string;
  lockdown?: boolean;
  onToggleLockdown?: () => void;
  /** The message being answered (the message menu's Reply, R1-03); it rides on the next send and then clears. */
  replyTo?: Reply | null;
  onClearReply?: () => void;
  /** In a room, the Classic room words (rooms/useShellRoom: "Message the group · @ to call a Trunk"). */
  placeholder?: string;
  /** The first Trunk waiting on a yes, for the roaming pet's tip (QUEUE item 18). */
  petWaiting?: string | null;
  /** The window already shows the Trunk getting ready (frame/StartupLine.tsx), so the composer adds no second line for it. */
  startupShown?: boolean;
};

type Menu = RowMenu | "plus" | "ring" | "mic" | null;

function readGoal(row: Record<string, unknown>): Goal | null {
  const g = rec(row.goal);
  if (!str(g.id) || g.status === "complete") return null;
  return { id: str(g.id), objective: str(g.objective), status: str(g.status), rounds: num(g.continuationTurns) ?? 0, note: str(g.lastStatusNote) };
}

export function Composer(props: Props) {
  const { name, engine, working, offline, onSend, onStop, onToast: toast, onOpen } = props;
  const sessionKey = engine.sessionKey;
  const conv = useConversation(engine);
  const draft = useDraft(sessionKey, engine.attachmentPolicy);
  const [menu, setMenu] = useState<Menu>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [searching, setSearching] = useState(false);
  const [photo, setPhoto] = useState(false), [picture, setPicture] = useState(false), [talking, setTalking] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [improving, setImproving] = useState(false), [improved, setImproved] = useState<{ before: string; after: string } | null>(null);
  const textNow = useRef("");
  useEffect(() => { setTarget(null); setMenu(null); }, [sessionKey]);
  const box = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  // Places fill this box with branch:compose (Customize's Use). The open conversation takes the words; any other one keeps them as its draft.
  useEffect(() => {
    const fill = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionKey?: unknown; text?: unknown }>).detail;
      if (typeof detail?.sessionKey !== "string" || typeof detail.text !== "string") return;
      if (detail.sessionKey === sessionKey) {
        draft.setText(detail.text);
        requestAnimationFrame(() => box.current?.focus());
      } else saveDraft(safeStorage(), detail.sessionKey, detail.text);
    };
    window.addEventListener(COMPOSE_EVENT, fill);
    return () => window.removeEventListener(COMPOSE_EVENT, fill);
  }, [sessionKey, draft.setText]);
  const plus = useRef<HTMLButtonElement>(null), ring = useRef<HTMLButtonElement>(null), mic = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenu(null), []);
  // HANDOFF R1-04: at a dock 300 px wide or less, Dictate and Improve fold into the + menu (size only, read from a ref).
  const dock = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(false);
  useLayoutEffect(() => {
    const node = dock.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setTight(node.clientWidth > 0 && node.clientWidth <= 300));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const voice = useVoiceCatalog(engine);
  const typed = useRef(draft.text);
  typed.current = draft.text;
  const dict = useDictation(engine, (words) => draft.setText(typed.current ? `${typed.current} ${words}` : words), setProblem);
  const note = useVoiceNote((file) => void draft.addFiles([file], "file"), setProblem);
  useEffect(() => {
    const start = () => voice.live && setTalking(true);
    window.addEventListener(TALK_EVENT, start);
    return () => window.removeEventListener(TALK_EVENT, start);
  }, [voice.live]);
  const prefs = useConversationPrefs(engine);
  const [vim, setVim] = useState<{ mode: VimMode; pending: string }>({ mode: "insert", pending: "" });

  const row = conv.row;
  const currentRef = currentModelRef(row, conv.defaults, conv.trunk?.model);
  const current = conv.models.find((m) => m.ref === currentRef || m.id === currentRef);
  const thinking = currentThinking(row, conv.defaults);
  const noModel = hasNoModel(conv, currentRef);
  const waitingForFreeModel = noModel && !conv.noKeySettled && !conv.noKeyError;
  const freeModelBlocked = waitingForFreeModel || Boolean(conv.noKeyError);
  const admin = isAdmin(engine.scopes ?? []);
  const mode: EngineMode | null = isEngineMode(row.permissionMode) ? row.permissionMode : null;
  const asSet = isEngineMode(conv.trunk?.defaultMode) ? (conv.trunk?.defaultMode as EngineMode) : null;
  const queueMode = str(row.effectiveQueueMode);
  const trunkName = conv.trunk?.name || name;
  const conversationProblem = conv.error ?? (isPreparationPending(conv.modelsError) || conv.modelsError?.includes("is still starting up.") ? conv.modelsError : null);

  const drawer = useDrawer(engine, conv.trunks, current?.levels ?? [], useMemo(() => ({ think: thinking }), [thinking]));
  const [picks, setPicks] = useState<SkillPick[]>([]);
  const seenText = useRef(draft.text);
  useEffect(() => {
    const before = seenText.current;
    seenText.current = draft.text;
    if (before !== draft.text) setPicks((now) => reconcilePicks(now, before, draft.text));
  }, [draft.text]);
  const sendMessage = (message: Message, parts: { files?: typeof draft.files; people?: typeof draft.people; queue?: string; replyTo?: Reply | null; id?: string } = {}) => {
    const text = resolveSend(message.text, message.picks, drawer.skills);
    return onSend(text, buildExtras(text, parts.files ?? [], parts.people ?? [], parts.queue, parts.replyTo), parts.id);
  };
  const line = useWaitingLine(sessionKey, working, offline, (item, steer) => {
    sendMessage({ text: item.text, picks: item.picks ?? [] }, { files: item.files, queue: steer ? "steer" : undefined, id: item.id });
    if (steer) toast(`Steered ${trunkName}. It picks this up at its next step.`);
  });
  const bg = useBackground(engine, conv.trunkId, props.mainKey);
  const view = draft.text === dismissed ? null : drawer.view(draft.text, caret);
  const history = useHistoryKeys(engine, draft.text, draft.setText);

  const patch = async (fields: Record<string, unknown>) => {
    const error = await conv.patch(fields);
    setProblem(error);
    return error;
  };
  const pickMode = async (next: EngineMode | null) => {
    if (props.lockdown) return;
    setMenu(null);
    if ((await patch({ permissionMode: next })) === null) toast(`${next ? modeName(next) : `As set · ${modeName(asSet)}`} in this conversation.`);
  };
  const runBackground = async (text: string) => {
    if (props.lockdown) { setProblem("Lockdown is on: Trunks cannot run or send anything."); return; }
    if (!text.trim()) { draft.setText("/bg "); box.current?.focus(); return; }
    const error = await bg.start(text.trim());
    setProblem(error);
    if (!error) { draft.clear(); toast("Running in the background. Keep talking here."); }
  };
  const topic = props.topics.find((t) => t.key === target);
  /** "to …": the words go to that topic (chat.send on its key) while you stay in the Main chat. */
  const sendToTopic = async (key: string, title: string) => {
    const message = trimMessage({ text: draft.text, picks });
    const text = resolveSend(message.text, message.picks, drawer.skills);
    try {
      await engine.request("chat.send", { ...buildExtras(text, draft.files, draft.people), sessionKey: key, message: text, idempotencyKey: crypto.randomUUID() });
      draft.clear();
      toast(`Sent to ${title}.`);
    } catch (error) {
      setProblem(friendlyModelError(error instanceof Error ? error.message : String(error)));
    }
  };

  const submit = (alt: boolean) => {
    const plan = planSend(draft.text, draft.files.length > 0, working, queueMode, alt);
    if (plan.kind === "nothing") return;
    if (props.lockdown && plan.kind !== "stop") {
      setProblem(draft.text.trim().startsWith("!") ? "Lockdown is on: commands can't run." : "Lockdown is on: Trunks cannot run or send anything.");
      return;
    }
    if (plan.kind === "stop") { onStop(); draft.clear(); return; }
    if (offline) return;
    if (freeModelBlocked && plan.kind !== "command") {
      setProblem(waitingForFreeModel ? FREE_MODEL_READY : CONNECT_MODEL_ANSWERS);
      return;
    }
    if (isPreparationPending(conversationProblem) && plan.kind !== "background") return;
    if (plan.kind === "background") { void runBackground(plan.text); return; }
    if (topic && plan.kind === "send") { void sendToTopic(topic.key, topic.title); return; }
    if (plan.kind === "wait") {
      const message = trimMessage({ text: draft.text, picks });
      line.add(message.text, draft.files, message.picks);
    } else {
      sendMessage(trimMessage({ text: draft.text, picks }), { files: draft.files, people: draft.people, queue: plan.kind === "send" ? plan.queueMode : undefined, replyTo: props.replyTo });
      props.onClearReply?.();
      if (plan.kind === "send" && plan.queueMode === "steer") toast(`Steered ${trunkName}. It picks this up at its next step.`);
    }
    history.record(draft.text.trim());
    draft.clear();
  };

  const focusAt = (at: number) => requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(at, at); });
  const pick = (p: Pick) => {
    if (p.kind === "context") {
      const before = draft.text.slice(0, p.token.start), after = draft.text.slice(p.token.end);
      setSel(0);
      if (p.key === "file" || p.key === "folder") {
        draft.setText(`${before}${after.replace(/^ /, "")}`);
        (p.key === "file" ? fileInput : folderInput).current?.click();
        return;
      }
      const token = `@${p.key}:`;
      draft.setText(`${before}${token}${after}`);
      setCaret(before.length + token.length);
      focusAt(before.length + token.length);
      return;
    }
    let next: { text: string; caret: number };
    if (p.kind === "command") next = { text: `/${p.command.name} `, caret: p.command.name.length + 2 };
    else if (p.kind === "choice") next = { text: `/${p.command.name} ${p.value}`, caret: p.command.name.length + p.value.length + 2 };
    else next = replaceToken(draft.text, p.token, p.kind === "skill" ? pickText(p.name) : `@${p.name}`);
    if (p.kind === "person") draft.addPerson({ profileId: p.profileId, name: p.name });
    if (p.kind === "skill") {
      seenText.current = next.text;
      setPicks((now) => [...reconcilePicks(now, draft.text, next.text), newPick(p.token.start, p.name)]);
    }
    draft.setText(next.text);
    setCaret(next.caret);
    if (p.kind === "choice") setDismissed(next.text);
    setSel(0);
    focusAt(next.caret);
  };

  const onVimKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (vim.mode === "insert") {
      if (e.key !== "Escape" || view) return false;
      e.preventDefault(); e.stopPropagation();
      setVim({ mode: "normal", pending: "" });
      return true;
    }
    if (e.key === "Enter" || e.key.startsWith("Arrow") || e.key === "Tab") return false;
    const r = vimKey({ text: draft.text, caret: e.currentTarget.selectionStart, mode: "normal", pending: vim.pending }, e.key);
    if (!r.handled) return false;
    e.preventDefault();
    if (r.text !== draft.text) draft.setText(r.text);
    setVim({ mode: r.mode, pending: r.pending });
    requestAnimationFrame(() => box.current?.setSelectionRange(r.caret, r.caret));
    return true;
  };
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (view) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + view.rows.length) % view.rows.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(view.picks[Math.min(sel, view.picks.length - 1)]); return; }
      if (e.key === "Escape") { e.preventDefault(); setDismissed(draft.text); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") { e.preventDefault(); setSearching(true); return; }
    if (prefs.vimKeys && onVimKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      const mod = e.ctrlKey || e.metaKey;
      if (prefs.sendWith === "ctrl" && !mod) return;
      e.preventDefault();
      submit(prefs.sendWith === "ctrl" ? false : mod);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      const next = props.lockdown ? null : nextMode(mode ?? asSet, admin);
      if (next) void pickMode(next);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setMenu("model");
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") history.onArrow(e);
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) { e.preventDefault(); void draft.addFiles(files, "paste"); return; }
    const pasted = e.clipboardData.getData("text/plain");
    if (pasted.length > PASTED_TEXT_CHIP_CHARS) { e.preventDefault(); draft.addPastedText(pasted); }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void draft.addFiles([...e.dataTransfer.files], "file"); };

  const goal = readGoal(row);
  const goalAction = async (action: "pause" | "resume" | "clear" | "edit", text?: string) => {
    if (!sessionKey || !goal) return;
    const base = { sessionKey, goalId: goal.id, operationId: crypto.randomUUID(), issuedAtMs: Date.now() };
    try {
      if (action === "clear") await engine.request("sessions.goal.clear", base);
      else await engine.request("sessions.goal.update", action === "edit" ? { ...base, action, objective: text ?? "" } : { ...base, action });
      await conv.reload();
      const words = { clear: "Goal cleared.", pause: "Goal paused. /goal resume carries on.", edit: "Goal changed. It carries on from here.", resume: "" }[action];
      if (words) toast(words);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };
  const insert = (text: string) => {
    const next = text === "/" ? `${draft.text}${draft.text && !draft.text.endsWith(" ") ? " " : ""}/` : text;
    draft.setText(next);
    setCaret(next.length);
    setDismissed(null);
    requestAnimationFrame(() => box.current?.focus());
  };

  const hasText = draft.text.trim().length > 0;
  // Improve my draft (#977): the side model rewrites the draft; it lands only if nothing was typed meanwhile.
  textNow.current = draft.text;
  const improve = async () => {
    const before = draft.text;
    if (!before.trim() || improving || !sessionKey) return;
    setImproving(true); setProblem(null); setMenu(null);
    try {
      const result = await engine.request<{ answer?: unknown }>(IMPROVE_NEED, { sessionKey, question: improvePrompt(before) });
      const after = improvedText(rec(result).answer);
      if (!after) { setProblem("Your model didn’t return a rewrite, so your draft is unchanged."); return; }
      if (textNow.current !== before) return;
      draft.setText(after); setImproved({ before, after });
    } catch (error) {
      setProblem(`Couldn’t improve the draft: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImproving(false);
    }
  };
  const hasDraft = hasText || draft.files.length > 0;
  const stopMode = working && !hasDraft;
  const ready = hasDraft && !offline && !props.lockdown && draft.preparing === 0 && !isPreparationPending(conversationProblem) && !freeModelBlocked;
  const usage = tightest(props.limits);
  const context = contextUse(props.row?.totalTokens, props.row?.contextTokens);
  const runningCount = props.running.length;
  const summary = ringSummary(usage, runningCount, context);
  const sendWhy = offline ? "Offline: Branch is reconnecting." : props.lockdown ? "Lockdown is on." : waitingForFreeModel ? FREE_MODEL_READY : freeModelBlocked ? CONNECT_MODEL_ANSWERS : working && hasDraft ? sendTooltip(queueMode) : undefined;
  const placeholder = waitingForFreeModel ? FREE_MODEL_READY : noModel ? "Connect a model to start" : props.placeholder ?? `Message ${name}`;
  const notes = [conversationProblem, problem, line.error].filter((n): n is string => Boolean(n) && !(props.startupShown && (isPreparationPending(n) || isPreparationStalled(n))));

  return <div ref={dock} className="r1c" data-tight={tight || undefined} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
    {dragging ? <div className="c-droplayer">Drop files to add them</div> : null}
    {notes.filter((n) => !isNoUsableModelError(n)).map((n, i) =>
      <p key={i} className={isPreparationPending(n) ? "r1c-note" : "r1c-note bad"} role={isPreparationPending(n) ? "status" : "alert"}>{isPreparationPending(n) ? preparationLabel(trunkName) : n === FREE_MODEL_READY ? n : shortReason(n)}</p>)}
    {conv.noKeyError || notes.some(isNoUsableModelError) ? <ConnectModelNotice onOpen={onOpen} className="r1c-connect" onRetry={conv.noKeyError ? () => void conv.retryNoKey() : undefined} /> : null}
    {draft.note ? <p className="r1c-note">{draft.note}</p> : null}
    {improved && draft.text === improved.after ? <p className="r1c-note" role="status">Improved your draft · <button type="button" className="r1c-undo" data-local="" onClick={() => { draft.setText(improved.before); setImproved(null); box.current?.focus(); }}>Undo</button></p> : null}
    {drawer.peopleError && view?.kind === "mention" ? <p className="r1c-note bad">{drawer.peopleError}</p> : null}
    {props.replyTo ? <div className="c-dock-row"><span className="r1c-chip" data-testid="reply-chip"><Icon name="back" size={14} />Replying to {props.replyTo.name}: {props.replyTo.text.slice(0, 60)}
      <button type="button" className="c-x" aria-label="Don't reply" onClick={props.onClearReply}><Icon name="x" size={12} /></button></span></div> : null}
    <DockRow plan={null} trunkName={trunkName} working={working} offline={offline} line={line.line}
      onReword={(id, text) => { line.reword(id, text); toast("Reworded. It goes as you wrote it now."); }} onMoveUp={line.moveUp} onRemove={line.remove} onSteerQueued={line.steerNow} onRetry={line.retry}
      jobs={bg.jobs} onStopJob={async (key) => { const error = await bg.stop(key); setProblem(error); if (!error) toast("Stopped. Nothing it started was left half done."); }} onOpenJob={props.onOpenConversation}
      goal={goal} onGoal={(a, t) => void goalAction(a, t)} files={draft.files} preparing={draft.preparing}
      onRemoveFile={(id) => { draft.removeFile(id); box.current?.focus(); }} onShowText={(id) => { const f = draft.takeFile(id); if (f?.text) draft.setText(draft.text ? `${draft.text}\n${f.text}` : f.text); }}
      people={draft.people} onForget={draft.forget} onSteer={async (text) => { sendMessage({ text, picks: [] }, { queue: "steer" }); toast(`Steered ${trunkName}. It picks this up at its next step.`); return true; }} />
    {talking ? <VoiceScreen engine={engine} name={trunkName} onClose={() => setTalking(false)} /> : null}
    <ComposerPet engine={engine} working={props.running.length > 0} waiting={props.petWaiting ?? null} />
    <form className="r1c-pill" data-text={hasDraft || undefined} data-temp={row.incognito === true || undefined} onSubmit={(e) => { e.preventDefault(); if (stopMode) onStop(); else submit(false); }}>
      {view ? <Drawer kind={view.kind} label={view.label} rows={view.rows} selected={Math.min(sel, view.rows.length - 1)} footer={view.footer} groupLabel={(i) => view.groups[i]} onHover={setSel} onPick={(i) => pick(view.picks[i])} /> : null}
      <button ref={plus} type="button" className="r1c-btn" data-local="" aria-label="Attach, mention a Trunk, skills" aria-haspopup="menu" aria-expanded={menu === "plus"} title="Add to the message" onClick={() => setMenu(menu === "plus" ? null : "plus")}><Icon name="plus" /></button>
      {note.on ? <VoiceNoteStrip started={note.started} onDone={note.done} /> : dict.on ? <DictationStrip level={dict.level} heard={dict.heard} onDone={() => void dict.done()} /> : (
        <textarea ref={box} data-testid="composer" rows={1} value={draft.text} placeholder={placeholder} aria-label={`Message ${name}`} data-need="chat.send"
          onChange={(e) => { draft.setText(e.target.value); setCaret(e.target.selectionStart); setSel(0); if (e.target.value.includes("@")) drawer.loadPeople(); }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={onKey} onPaste={onPaste} onBlur={() => setDismissed(draft.text)} onFocus={() => setDismissed(null)} />
      )}
      {prefs.vimKeys && vim.mode === "normal" ? <span className="r1c-flag" data-testid="vim-normal">Normal</span> : null}
      {row.incognito === true ? <span className="r1c-flag">Temporary</span> : null}
      {hasText && !tight ? <Coming engine={engine} need={IMPROVE_NEED} reason={IMPROVE_COMING} where="Improve my draft"><button type="button" className="r1c-btn" aria-label="Improve my draft" title={improving ? "Improving…" : "Improve my draft"} aria-busy={improving || undefined} disabled={improving} onClick={() => void improve()}><Icon name="spark" /></button></Coming> : null}
      {dict.on || tight ? null : voice.dictation
        ? <button type="button" className="r1c-btn" data-need="talk.catalog" aria-label="Dictate into the box" title="Dictate into the box" onClick={() => void dict.start()}><Icon name="mic" /></button>
        : voice.loaded && availability(engine, "talk.catalog") !== "no"
          // The engine answers, but no voice service is on yet: the mic says how to turn one on (never a dead button).
          ? <button type="button" ref={mic} className="r1c-btn" data-need="talk.catalog" aria-label="Dictate into the box" title={TURN_ON_VOICE} aria-haspopup="dialog" aria-expanded={menu === "mic"} onClick={() => setMenu(menu === "mic" ? null : "mic")}><Icon name="mic" /></button>
          : <Later need="talk.catalog" reason={VOICE_OFF} where="Dictate into the box"><button type="button" className="r1c-btn" aria-label="Dictate into the box"><Icon name="mic" /></button></Later>}
      <Ring ref={ring} usage={usage?.percent ?? null} context={context?.percent ?? null} running={runningCount} label={summary} open={menu === "ring"} onOpen={() => setMenu(menu === "ring" ? null : "ring")} />
      {stopMode
        ? <button type="submit" className="r1c-send stop" data-need="chat.abort" aria-label="Stop" title="Stop"><StopMark /></button>
        : hasDraft
          ? <button type="submit" key="send" className="r1c-send" data-need="chat.send" aria-label="Send" title={sendWhy} disabled={!ready} aria-disabled={!ready || undefined} data-blocked={freeModelBlocked ? "true" : undefined}><Icon name="up" stroke={2.2} /></button>
          : voice.live
            ? <button type="button" key="voice" className="r1c-btn" data-need="talk.catalog" aria-label="Talk live with voice" title="Talk live with voice" onClick={() => setTalking(true)}><Icon name="wave" /></button>
            : <Later need="talk.session.create" reason={VOICE_OFF} where="Talk live with voice"><button type="button" key="voice" className="r1c-btn" aria-label="Talk live with voice"><Icon name="wave" /></button></Later>}
      <input ref={(el) => { folderInput.current = el; el?.setAttribute("webkitdirectory", ""); }} type="file" hidden data-local="" onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        const listing = folderContext(files.map((f) => f.webkitRelativePath || f.name));
        if (listing) draft.addPastedText(listing);
        void draft.addFiles(files, "file");
        e.target.value = "";
      }} />
      <input ref={fileInput} type="file" multiple hidden data-local="" onChange={(e) => { void draft.addFiles([...(e.target.files ?? [])], "file"); e.target.value = ""; }} />
    </form>
    <Row engine={engine} menu={menu === "plus" || menu === "ring" || menu === "mic" ? null : menu} setMenu={setMenu} close={close} conv={conv} current={current} currentRef={currentRef} thinking={thinking}
      mode={mode} asSet={asSet} admin={admin} noModel={noModel} trunkName={trunkName} lockdown={props.lockdown} onToggleLockdown={props.onToggleLockdown}
      pickMode={(m) => void pickMode(m)} patch={patch} onOpen={onOpen} onToast={toast} onProblem={setProblem}
      topics={props.row?.isMain && props.topics.length ? props.topics : []} target={topic ?? null} onTarget={(key) => { setTarget(key); setMenu(null); }} />
    {menu === "plus" ? <PlusMenu anchor={plus} onClose={close} hasModel={!noModel} voiceLive={voice.live}
      onFiles={() => fileInput.current?.click()} onPhoto={() => setPhoto(true)} onFolder={() => folderInput.current?.click()} onPicture={() => setPicture(true)}
      onInsert={insert} onBackground={() => void runBackground(draft.text)} onOpen={onOpen} onCall={() => setTalking(true)}
      tight={tight} engine={engine} onImprove={hasText && !improving ? () => void improve() : undefined} onDictate={tight && voice.dictation && !dict.on ? () => void dict.start() : undefined}
      onVoiceNote={typeof MediaRecorder !== "undefined" && navigator.mediaDevices ? () => void note.start() : undefined} /> : null}
    {menu === "mic" ? <Popover anchor={mic} label="Voice" onClose={close} width={260} placement="above">
      <div className="r1c-menu" data-testid="mic-off">
        <section className="r1c-sec">
          <p className="c-pp"><b>{TURN_ON_VOICE}</b></p>
          <button type="button" className="btn sm" data-local="" onClick={() => { setMenu(null); onOpen("settings/voice"); }}>Open Settings</button>
        </section>
      </div>
    </Popover> : null}
    {menu === "ring" ? <RingPopover anchor={ring} onClose={close} engine={engine} sessionKey={sessionKey} name={trunkName} working={working} offline={offline}
      context={context} row={props.row} running={props.running} limits={props.limits} onOpen={onOpen} onOpenConversation={(key) => { setMenu(null); props.onOpenConversation(key); }} /> : null}
    {searching ? <HistorySearch anchor={box} engine={engine} sent={history.sentList()} draft={draft.text} onPreview={draft.setText} onDone={(t) => { setSearching(false); draft.setText(t); requestAnimationFrame(() => box.current?.focus()); }} /> : null}
    {picture ? <PictureDialog onClose={() => setPicture(false)} onMake={(words) => sendMessage({ text: `Make a picture: ${words}`, picks: [] })} /> : null}
    {photo ? <PhotoDialog onClose={() => setPhoto(false)} onUse={(f) => void draft.addFiles([f], "file")} onUpload={() => fileInput.current?.click()} /> : null}
  </div>;
}
