// The composer (DESIGN-SPEC §4.3): the message box, +, the plug, the model and mode chips, voice and Send/Stop,
// the dock row above it and the menus, all wired to the engine through the shared handle (connect/engine.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { displayName } from "../display-names";
import { PASTED_TEXT_CHIP_CHARS } from "./attachments";
import { isPreparationPending, preparationLabel } from "../connect/preparation-status";
import { DockRow, type Goal } from "./DockRow";
import { isAdmin, num, rec, str, type SendExtras, type WindowEngine } from "./engine";
import { Icon, StopMark } from "./icons";
import { replaceToken } from "./mention";
import { leadingCommand, newPick, pickText, reconcilePicks, resolveSend, type SkillPick } from "./skill-picks";
import { isEngineMode, modeName, nextMode, type EngineMode } from "./mode";
import { composerChipLabel, currentModelRef, currentThinking } from "./model";
import { ModelMenu } from "./ModelMenu";
import { Popover } from "./Popover";
import { serviceName } from "../places/settings/set1/service";
import { ModeMenu } from "./ModeMenu";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { PhotoDialog, PictureDialog } from "./PhotoDialog";
import { PlugMenu } from "./PlugMenu";
import { PlusMenu } from "./PlusMenu";
import { buildExtras, planSend, sendTooltip, type Reply } from "./sending";
import { Drawer } from "./SlashDrawer";
import { useBackground } from "./useBackground";
import { hasNoModel, useConversation } from "./useConversation";
import { safeStorage, saveDraft } from "./drafts";
import { useConversationPrefs } from "../thread/prefs";
import { shortReason } from "../thread/format";
import { currentModelAccount, shortAccountEmail, useModelAccounts } from "./useModelAccount";
import { vimKey, type VimMode } from "./vim";
import { useDraft } from "./useDraft";
import { useDrawer, type Pick } from "./useDrawer";
import { useHistoryKeys } from "./useHistoryKeys";
import { HistorySearch } from "./HistorySearch";
import { diffContext, folderContext } from "./context";
import { useWaitingLine } from "./useWaitingLine";
import { DictationStrip, TALK_EVENT, useDictation, useVoiceCatalog, useVoiceNote, VoiceNoteStrip, VoiceScreen } from "./VoiceParts";
import "./composer.css";

type Props = {
  name: string;
  working: boolean;
  disabled: boolean;
  onSend: (text: string, extras?: SendExtras, idempotencyKey?: string) => void | Promise<boolean>;
  onStop: () => void;
  engine?: WindowEngine;
  sessionKey?: string | null;
  onReload?: () => void;
  onToast?: (text: string) => void;
  onOpen?: (target: OpenTarget) => void;
  onOpenConversation?: (key: string) => void;
  lastUserEntryId?: string;
  replyTo?: Reply | null;
  onClearReply?: () => void;
  offline?: boolean;
  /** The computer hosting this Branch connection. */
  connectionTarget?: string;
  /** Drawn just above the message box, under the dock row: the waiting question (§4.2.2 "Question above the message box"). */
  above?: ReactNode;
  /** The plan's progress for the dock row's "1 of 4" chip. */
  plan?: { done: number; total: number; steps: { step: string; status: string }[] } | null;
  /** In a room: "Message the room · @ to call a Trunk" (rooms/, §4.3.1); else "Message <Trunk>". */
  placeholder?: string;
  /** An unsaved topic; its first send is handled by the shell. */
  draftAgentId?: string;
  draftTemporary?: boolean;
  onNewTopic?: (agentId: string, options?: Record<string, unknown>) => void;
  mainKey?: string;
  lockdown?: boolean;
  onToggleLockdown?: () => void;
};

type Menu = "plus" | "plug" | "tune" | null;

export const VOICE_OFF = "Off until you choose: it uses the microphone. Turn it on in Settings › Voice.";

function readGoal(row: Record<string, unknown>): Goal | null {
  const g = rec(row.goal);
  if (!str(g.id) || g.status === "complete") return null;
  return { id: str(g.id), objective: str(g.objective), status: str(g.status), rounds: num(g.continuationTurns) ?? 0, note: str(g.lastStatusNote) };
}

/** Another place fills a conversation's message box: dispatch `branch:compose` with { sessionKey, text } and
 *  then open that conversation. The words are kept as its draft, so they wait there if it isn't open yet. */
export const COMPOSE_EVENT = "branch:compose";
function useComposeEvent(open: string | null, setText: (t: string) => void, box: React.RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const fill = (e: Event) => {
      const d = (e as CustomEvent<{ sessionKey?: unknown; text?: unknown }>).detail;
      if (typeof d?.sessionKey !== "string" || typeof d.text !== "string") return;
      if (d.sessionKey === open) {
        setText(d.text);
        requestAnimationFrame(() => box.current?.focus());
      } else saveDraft(safeStorage(), d.sessionKey, d.text);
    };
    window.addEventListener(COMPOSE_EVENT, fill);
    return () => window.removeEventListener(COMPOSE_EVENT, fill);
  }, [open, setText, box]);
}

/** The composer (DESIGN-SPEC §4.3.1): the message box and Send, which becomes Stop while the Trunk works. */
export function Composer(props: Props) {
  const { name, working, disabled, onSend, onStop, engine, onToast, onOpen } = props;
  const conv = useConversation(engine, props.draftAgentId);
  const draft = useDraft(props.draftAgentId ? null : engine?.sessionKey ?? null, engine?.attachmentPolicy);
  const [menu, setMenu] = useState<Menu>(null);
  const [nextAsJob, setNextAsJob] = useState(false);
  useEffect(() => setNextAsJob(false), [engine?.sessionKey]);
  const [photo, setPhoto] = useState(false);
  const [picture, setPicture] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const anchors = { plus: useRef<HTMLButtonElement>(null), plug: useRef<HTMLButtonElement>(null), tune: useRef<HTMLButtonElement>(null) };

  const voice = useVoiceCatalog(engine);
  const typed = useRef(draft.text);
  typed.current = draft.text;
  const dict = useDictation(engine, (words) => draft.setText(typed.current ? `${typed.current} ${words}` : words), setProblem);
  useComposeEvent(engine?.sessionKey ?? null, draft.setText, box);
  const prefs = useConversationPrefs(engine);
  const [vim, setVim] = useState<{ mode: VimMode; pending: string }>({ mode: "insert", pending: "" });
  const vimOn = prefs.vimKeys && vim.mode === "normal";
  const note = useVoiceNote((file) => void draft.addFiles([file], "file"), setProblem);
  const [talking, setTalking] = useState(false);
  useEffect(() => {
    const start = () => voice.live && setTalking(true);
    window.addEventListener(TALK_EVENT, start);
    return () => window.removeEventListener(TALK_EVENT, start);
  }, [voice.live]);
  const row = conv.row;
  const currentRef = currentModelRef(row, conv.defaults, conv.trunk?.model);
  const current = conv.models.find((m) => m.ref === currentRef || m.id === currentRef);
  const modelAccounts = useModelAccounts(engine, conv.trunkId, working);
  const modelAccount = currentModelAccount(modelAccounts, current?.provider ?? currentRef.split("/")[0] ?? "", row);
  const accountEmail = shortAccountEmail(modelAccount);
  const thinking = currentThinking(row, conv.defaults);
  const chip = composerChipLabel(current, thinking, conv.modelsLoaded);
  const chipName = composerChipLabel(current, "", conv.modelsLoaded);
  // No model set up: the engine names a default model but none is connected (models.list has none usable), or none at all.
  const noModel = hasNoModel(conv, currentRef);
  const admin = isAdmin(engine?.scopes ?? []);
  const mode: EngineMode | null = isEngineMode(row.permissionMode) ? row.permissionMode : null;
  const asSet = isEngineMode(conv.trunk?.defaultMode) ? (conv.trunk?.defaultMode as EngineMode) : null;
  const queueMode = str(row.effectiveQueueMode);
  const trunkName = conv.trunk?.name || name;
  const conversationProblem = conv.error ?? (isPreparationPending(conv.modelsError) || conv.modelsError?.includes("is still starting up.") ? conv.modelsError : null);
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);

  const levels = current?.levels ?? [];
  const drawer = useDrawer(engine, conv.trunks, levels, useMemo(() => ({ think: thinking }), [thinking]));
  const [picks, setPicks] = useState<SkillPick[]>([]);
  const seenText = useRef(draft.text);
  useEffect(() => {
    const before = seenText.current;
    seenText.current = draft.text;
    if (before !== draft.text) setPicks((current) => reconcilePicks(current, before, draft.text));
  }, [draft.text]);
  const deliver = useCallback(
    (typed: string, files = draft.files, people = draft.people, queue?: string) => {
      const text = leadingCommand(typed, drawer.skills);
      return onSend(text, buildExtras(text, files, people, queue, props.replyTo));
    },
    [onSend, draft.files, draft.people, props.replyTo, drawer.skills],
  );
  /** What the engine receives for the draft: picks and a typed leading command resolved, then trimmed. */
  const outgoing = () => resolveSend(draft.text, picks, drawer.skills).trim();
  const line = useWaitingLine(engine?.sessionKey ?? null, working, Boolean(props.offline), (item, steer) => {
    onSend(item.text, buildExtras(item.text, item.files, [], steer ? "steer" : undefined), item.id);
    if (steer) toast(`Steered ${trunkName}. It picks this up at its next step.`);
  });
  const bg = useBackground(engine, conv.trunkId, props.mainKey);
  const view = draft.text === dismissed ? null : drawer.view(draft.text, caret);
  const history = useHistoryKeys(engine, draft.text, draft.setText);

  const patch = async (fields: Record<string, unknown>) => {
    const err = await conv.patch(fields);
    setProblem(err);
    return err;
  };
  const pickMode = async (next: EngineMode | null) => {
    if (props.lockdown) return;
    setMenu(null);
    if ((await patch({ permissionMode: next })) === null) toast(`${next ? modeName(next) : `As set · ${modeName(asSet)}`} in this conversation.`);
  };
  const runBackground = async (text: string) => {
    if (props.lockdown) { setProblem("Lockdown is on: Trunks cannot run or send anything."); return; }
    if (!text.trim()) {
      toast("Type what to do first, then run it in the background.");
      return;
    }
    const err = await bg.start(text.trim());
    setProblem(err);
    if (!err) {
      draft.clear();
      toast("Running in the background. Keep talking here.");
    }
  };

  const submit = (alt: boolean) => {
    const plan = planSend(draft.text, draft.files.length > 0, working, queueMode, alt);
    if (plan.kind === "nothing") return;
    if (props.lockdown && plan.kind !== "stop") {
      setProblem(draft.text.trim().startsWith("!") ? "Lockdown is on: commands can't run." : "Lockdown is on: Trunks cannot run or send anything.");
      return;
    }
    if (noModel && plan.kind !== "command" && !draft.text.trim().startsWith("/")) return;
    if (nextAsJob && draft.files.length) {
      setProblem("A job starts with words. Send attachments in this conversation instead.");
      return;
    }
    if (nextAsJob && plan.kind === "send") {
      setNextAsJob(false);
      void runBackground(draft.text.trim());
      return;
    }
    if (plan.kind === "stop") {
      onStop();
      draft.clear();
      return;
    }
    if (isPreparationPending(conversationProblem) && plan.kind !== "background") return;
    if (plan.kind === "background") {
      void runBackground(plan.text);
      return;
    }
    if (noModel && plan.kind !== "command") return;
    if (props.draftAgentId) {
      void Promise.resolve(deliver(outgoing(), draft.files, draft.people)).then((created) => {
        if (created) draft.clear();
      });
      return;
    }
    if (plan.kind === "wait") {
      line.add(outgoing(), draft.files);
    } else {
      deliver(outgoing(), draft.files, draft.people, plan.kind === "send" ? plan.queueMode : undefined);
      if (plan.kind === "send" && plan.queueMode === "steer") toast(`Steered ${trunkName}. It picks this up at its next step.`);
    }
    history.record(draft.text.trim());
    draft.clear();
    props.onClearReply?.();
  };

  /** "@" Add as context: @file and @folder pick from this computer, @diff and @git read sessions.diff, and @url,
   *  @web and @conversation stay in the words for the Trunk to read with its own tools. */
  const addContext = async (p: Extract<Pick, { kind: "context" }>) => {
    const before = draft.text.slice(0, p.token.start);
    const after = draft.text.slice(p.token.end);
    setSel(0);
    if (p.key === "url" || p.key === "web" || p.key === "conversation") {
      const tok = `@${p.key}:`;
      draft.setText(`${before}${tok}${after}`);
      const at = before.length + tok.length;
      setCaret(at);
      requestAnimationFrame(() => {
        box.current?.focus();
        box.current?.setSelectionRange(at, at);
      });
      return;
    }
    draft.setText(`${before}${after.replace(/^ /, "")}`);
    if (p.key === "file") fileInput.current?.click();
    else if (p.key === "folder") folderInput.current?.click();
    else if (engine?.sessionKey) {
      try {
        const got = diffContext(p.key, await engine.request("sessions.diff", { sessionKey: engine.sessionKey, scope: p.key === "diff" ? "uncommitted" : "all" }));
        if ("text" in got) draft.addPastedText(got.text);
        setProblem("problem" in got ? got.problem : null);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : String(e));
      }
    }
  };

  const pick = (p: Pick) => {
    if (p.kind === "context") {
      void addContext(p);
      return;
    }
    let next: { text: string; caret: number };
    if (p.kind === "command") next = { text: `/${p.command.name} `, caret: p.command.name.length + 2 };
    else if (p.kind === "choice") next = { text: `/${p.command.name} ${p.value}`, caret: p.command.name.length + p.value.length + 2 };
    else next = replaceToken(draft.text, p.token, p.kind === "skill" ? pickText(p.name) : `@${p.name}`);
    if (p.kind === "person") draft.addPerson({ profileId: p.profileId, name: p.name });
    if (p.kind === "skill") {
      seenText.current = next.text;
      setPicks((current) => [...reconcilePicks(current, draft.text, next.text), newPick(p.token.start, p.name)]);
    }
    draft.setText(next.text);
    setCaret(next.caret);
    if (p.kind === "choice") setDismissed(next.text);
    setSel(0);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (view) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + view.rows.length) % view.rows.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(view.picks[Math.min(sel, view.picks.length - 1)]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(draft.text);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "r") {
      e.preventDefault();
      setSearching(true);
      return;
    }
    if (prefs.vimKeys && onVimKey(e)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      const mod = e.ctrlKey || e.metaKey;
      // "Send with: Ctrl Enter" (§4.7.1): Enter adds a line and Ctrl Enter sends.
      if (prefs.sendWith === "ctrl" && !mod) return;
      e.preventDefault();
      submit(prefs.sendWith === "ctrl" ? false : mod);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (props.lockdown) return;
      const next = nextMode(mode ?? asSet, admin);
      if (next) void pickMode(next);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setMenu("tune");
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      history.onArrow(e);
    }
  };

  /** Vim keys: Escape goes to normal mode; in normal mode keys move and edit; Enter still sends. */
  const onVimKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (vim.mode === "insert") {
      if (e.key !== "Escape" || view) return false;
      e.preventDefault();
      e.stopPropagation();
      setVim({ mode: "normal", pending: "" });
      return true;
    }
    if (e.key === "Enter" || e.key.startsWith("Arrow") || e.key === "Tab") return false;
    const caretAt = e.currentTarget.selectionStart;
    const r = vimKey({ text: draft.text, caret: caretAt, mode: "normal", pending: vim.pending }, e.key);
    if (!r.handled) return false;
    e.preventDefault();
    if (r.text !== draft.text) draft.setText(r.text);
    setVim({ mode: r.mode, pending: r.pending });
    requestAnimationFrame(() => box.current?.setSelectionRange(r.caret, r.caret));
    return true;
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length) {
      e.preventDefault();
      void draft.addFiles(files, "paste");
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    if (pasted.length > PASTED_TEXT_CHIP_CHARS) {
      e.preventDefault();
      draft.addPastedText(pasted);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void draft.addFiles([...e.dataTransfer.files], "file");
  };

  const goal = readGoal(row);
  const goalAction = async (action: "pause" | "resume" | "clear" | "edit", text?: string) => {
    if (!engine?.sessionKey || !goal) return;
    const base = { sessionKey: engine.sessionKey, goalId: goal.id, operationId: crypto.randomUUID(), issuedAtMs: Date.now() };
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

  /** A temporary topic is still only created with its first message. */
  const startTemporary = async () => {
    if (conv.trunkId) props.onNewTopic?.(conv.trunkId, { incognito: true });
  };

  const hasDraft = draft.text.trim().length > 0 || draft.files.length > 0;
  const stopMode = working && !hasDraft;
  // Sessions and history arrive before the engine finishes starting; sending waits for this Trunk.
  const ready = hasDraft && !disabled && !props.lockdown && draft.preparing === 0 && !isPreparationPending(conversationProblem) && (!noModel || draft.text.trim().startsWith("/"));
  // The session row's estimatedCostUsd is the latest run, not the conversation total.
  const [usageCost, setUsageCost] = useState<{ key: string; value: number } | null>(null);
  useEffect(() => {
    const key = engine?.sessionKey;
    if (!engine || !key) return;
    let live = true;
    const read = () => void engine.request("sessions.usage", { key, range: "all" }).then((result) => {
      const value = num(rec(rec(result).totals).totalCost);
      if (live && value !== undefined) setUsageCost({ key, value });
    }).catch(() => undefined);
    read();
    const timer = working ? setInterval(read, 10_000) : null;
    return () => { live = false; if (timer) clearInterval(timer); };
  }, [engine, engine?.sessionKey, working, row.updatedAt]);
  const cost = usageCost && usageCost.key === engine?.sessionKey ? usageCost.value : undefined;
  const temporary = props.draftTemporary === true || row.incognito === true;

  return (
    <div
      className="dock c-wrap"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {dragging ? <div className="c-droplayer">Drop files to add them</div> : null}
      {noModel ? <NoModelLine onOpen={onOpen} /> : null}
      {conversationProblem ? <p className={isPreparationPending(conversationProblem) ? "c-note" : "c-note bad"} role={isPreparationPending(conversationProblem) ? "status" : "alert"}>{isPreparationPending(conversationProblem) ? preparationLabel(trunkName) : shortReason(conversationProblem)}</p> : null}
      {problem ? <p className="c-note bad" role="alert">{isPreparationPending(problem) ? preparationLabel(trunkName) : shortReason(problem)}</p> : null}
      {line.error ? <p className="c-note bad" role="alert">{isPreparationPending(line.error) ? preparationLabel(trunkName) : shortReason(line.error)}</p> : null}
      {draft.note ? <p className="c-note">{draft.note}</p> : null}
      {picks.length > 0 ? (
        <div className="c-dock-row">
          {picks.map((pick) => (
            <span key={`${pick.start}:${pick.raw}`} className="c-chip" role="img" aria-label={`Skill ${displayName(pick.raw)}, runs as ${pickText(pick.raw)}`}>{displayName(pick.raw)}</span>
          ))}
        </div>
      ) : null}
      {drawer.peopleError && view?.kind === "mention" ? <p className="c-note bad">{drawer.peopleError}</p> : null}
      {props.replyTo ? (
        <div className="c-dock-row">
          <span className="c-chip" data-testid="reply-chip">
            <Icon name="back" size={14} />
            Replying to {props.replyTo.name}: {props.replyTo.text.slice(0, 60)}
            <button type="button" className="c-x" aria-label="Don't reply" onClick={props.onClearReply}><Icon name="x" size={12} /></button>
          </span>
        </div>
      ) : null}
      <DockRow
        plan={prefs.taskProgress ? props.plan : null}
        planStarts={prefs.taskProgressStarts}
        trunkName={trunkName}
        working={working}
        offline={Boolean(props.offline)}
        line={line.line}
        onReword={(id, text) => {
          line.reword(id, text);
          toast("Reworded. It goes as you wrote it now.");
        }}
        onMoveUp={line.moveUp}
        onRemove={line.remove}
        onSteerQueued={line.steerNow}
        onRetry={line.retry}
        jobs={bg.jobs}
        onStopJob={async (key) => {
          const err = await bg.stop(key);
          setProblem(err);
          if (!err) toast("Stopped. Nothing it started was left half done.");
        }}
        onOpenJob={props.onOpenConversation}
        goal={goal}
        onGoal={(a, t) => void goalAction(a, t)}
        files={draft.files}
        preparing={draft.preparing}
        onRemoveFile={(id) => {
          draft.removeFile(id);
          box.current?.focus();
        }}
        onShowText={(id) => {
          const f = draft.takeFile(id);
          if (f?.text) draft.setText(draft.text ? `${draft.text}\n${f.text}` : f.text);
        }}
        people={draft.people}
        onForget={draft.forget}
        onSteer={async (text) => {
          deliver(text, [], [], "steer");
          toast(`Steered ${trunkName}. It picks this up at its next step.`);
          return true;
        }}
      />
      {props.above}
      {talking && engine ? <VoiceScreen engine={engine} name={trunkName} onClose={() => setTalking(false)} /> : null}
      <form
        className={`composer${temporary ? " temp" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (stopMode) onStop();
          else submit(false);
        }}
      >
        {view ? (
          <Drawer
            kind={view.kind}
            label={view.label}
            rows={view.rows}
            selected={Math.min(sel, view.rows.length - 1)}
            footer={view.footer}
            groupLabel={(i) => view.groups[i]}
            onHover={setSel}
            onPick={(i) => pick(view.picks[i])}
          />
        ) : null}
        <ToolButton refEl={anchors.plus} icon="plus" label="Attach, mention a Trunk, skills, Temporary" open={menu === "plus"} onClick={() => setMenu(menu === "plus" ? null : "plus")} testId="plus" />
        <ToolButton refEl={anchors.plug} icon="plug" label="Tools: connectors, skills, plugins and command-line tools" tip="Tools" open={menu === "plug"} onClick={() => setMenu(menu === "plug" ? null : "plug")} disabled={!engine} testId="plug" />
        {note.on ? <VoiceNoteStrip started={note.started} onDone={note.done} /> : dict.on ? <DictationStrip level={dict.level} heard={dict.heard} onDone={() => void dict.done()} /> : (
        <textarea
          ref={box}
          data-testid="composer"
          data-has-draft={draft.text.trim() || draft.files.length ? "" : undefined}
          rows={1}
          value={draft.text}
          placeholder={props.placeholder ?? `Message ${name}`}
          aria-label={`Message ${name}`}
          onChange={(e) => {
            draft.setText(e.target.value);
            setCaret(e.target.selectionStart);
            setSel(0);
            if (e.target.value.includes("@")) drawer.loadPeople();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKey}
          onPaste={onPaste}
          onBlur={() => setDismissed(draft.text)}
          onFocus={() => setDismissed(null)}
        />
        )}
        <span className="c-flags">
          {temporary ? <span className="c-flag">Temporary</span> : null}
          {vimOn ? <span className="c-flag" data-testid="vim-normal">Normal</span> : null}
        </span>
        {engine ? (
          <button ref={anchors.tune} type="button" className={`c-btn c-tune-button${props.lockdown ? " lockdown" : (mode ?? asSet) === "full" ? " full" : ""}`} data-testid="tune-button" aria-haspopup="dialog" aria-expanded={menu === "tune"}
            aria-label={`Model, access and usage: ${chip} · ${props.lockdown ? "Lockdown" : modeName(mode ?? asSet) || "As set"}${cost !== undefined ? ` · $${cost.toFixed(2)} so far` : ""}`}
            title={`${chipName} · ${props.lockdown ? "Lockdown" : modeName(mode ?? asSet) || "As set"}${accountEmail ? ` · ${accountEmail}` : ""}`}
            onClick={() => setMenu(menu === "tune" ? null : "tune")}>
            <Icon name={props.lockdown ? "lock" : "sliders"} />
            {props.lockdown ? <span>Lockdown</span> : (mode ?? asSet) === "full" ? <Icon name="lock" size={10} /> : null}
            {str(row.activeModel) && str(row.activeModel) !== str(row.model) ? <i className="c-tune-attention" aria-hidden="true" /> : null}
          </button>
        ) : null}
        {dict.on ? null : (
          <button type="button" className="c-btn" aria-label="Dictate into the box" title={voice.dictation ? "Dictate into the box" : VOICE_OFF} disabled={!voice.dictation} data-testid="dictate" onClick={() => void dict.start()}>
            <Icon name="mic" />
          </button>
        )}
        <button type="button" className="c-btn c-talk" aria-label="Talk live with voice" title={voice.live ? "Talk live with voice" : VOICE_OFF} disabled={!voice.live} data-testid="talk-live" onClick={() => setTalking(true)}>
          <Icon name="wave" />
        </button>
        <button
          type="submit"
          className={stopMode ? "send stop" : ready ? "send ready" : "send"}
          aria-label={stopMode ? "Stop" : "Send"}
          title={working && hasDraft ? sendTooltip(queueMode) : undefined}
          disabled={!stopMode && !ready}
        >
          {stopMode ? <StopMark /> : <Icon name="up" stroke={2.2} />}
        </button>
        <input
          ref={(el) => {
            folderInput.current = el;
            el?.setAttribute("webkitdirectory", "");
          }}
          type="file"
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            const listing = folderContext(files.map((f) => f.webkitRelativePath || f.name));
            if (listing) draft.addPastedText(listing);
            void draft.addFiles(files, "file");
            e.target.value = "";
          }}
        />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { void draft.addFiles([...(e.target.files ?? [])], "file"); e.target.value = ""; }} />
        {menu === "plus" ? (
          <PlusMenu
            anchor={anchors.plus}
            onClose={() => setMenu(null)}
            trunks={conv.trunks}
            trunkId={conv.trunkId}
            onAttach={() => fileInput.current?.click()}
            onFolder={() => folderInput.current?.click()}
            onPhoto={() => setPhoto(true)}
            onPicture={noModel ? undefined : () => setPicture(true)}
            onInsert={(t) => {
              const next = t === "@" || t === "/" ? `${draft.text}${draft.text && !draft.text.endsWith(" ") ? " " : ""}${t}` : t;
              draft.setText(next);
              setCaret(next.length);
              setDismissed(null);
              requestAnimationFrame(() => box.current?.focus());
            }}
            onBackground={() => {
              if (draft.text.trim()) void runBackground(draft.text);
              else { draft.setText("/bg "); box.current?.focus(); }
            }}
            onOpen={onOpen}
            temporary={temporary}
            onTemporary={props.onNewTopic ? () => void startTemporary() : undefined}
            onWhoAnswers={props.draftAgentId ? (agentId) => props.onNewTopic?.(agentId) : undefined}
            onVoiceNote={typeof MediaRecorder !== "undefined" && navigator.mediaDevices ? () => void note.start() : undefined}
          />
        ) : null}
        {menu === "plug" && engine ? (
          <PlugMenu anchor={anchors.plug} onClose={() => setMenu(null)} engine={engine} row={row} trunkName={trunkName} isAdmin={admin} patch={patch} onToast={onToast} onOpen={onOpen} />
        ) : null}
        {menu === "tune" ? (
          <Popover anchor={anchors.tune} onClose={() => setMenu(null)} label="Model, access and usage" className="c-tune c-model c-mode" align="right">
            <section className="c-tune-section"><h3>Model</h3>
          <ModelMenu embedded
            anchor={anchors.tune}
            onClose={() => setMenu(null)}
            models={conv.models}
            loading={conv.modelsLoading}
            error={isPreparationPending(conv.modelsError) ? preparationLabel(trunkName) : conv.modelsError}
            current={current}
            currentRef={current?.ref ?? currentRef}
            row={row}
            thinking={thinking}
            trunkName={trunkName}
            isAdmin={admin}
            patch={async (f) => void (await patch(f))}
            onKeepForTrunk={async (m) => {
              try {
                await engine?.request("agents.update", { agentId: conv.trunkId, model: m.ref });
                await conv.reload();
                toast(`${trunkName} uses ${m.name} from now on.`);
              } catch (error) {
                setProblem(error instanceof Error ? error.message : String(error));
              }
            }}
            onOpen={onOpen}
            onRetry={() => void conv.readModelList()}
            engine={engine}
            trunkId={conv.trunkId}
          />
            <div className="c-tune-line"><span>Runs on {current?.local ? "this computer" : current ? serviceName(current.provider) : "no model"}{modelAccount ? ` · ${modelAccount.a.displayName || modelAccount.a.profileId}` : ""}{modelAccount?.a.email ? <small>{modelAccount.a.email}</small> : null}</span>
              <button type="button" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => { setMenu(null); onOpen?.("settings/accounts"); }}>Change</button></div>
            <div className="c-tune-line"><button type="button" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => { setMenu(null); onOpen?.("settings/models"); }}>Manage models…</button></div>
            </section>
            <section className="c-tune-section"><h3>Access</h3>
              <ModeMenu embedded anchor={anchors.tune} onClose={() => setMenu(null)} mode={mode} asSet={asSet} canSelectFull={admin} lockdown={props.lockdown} onToggleLockdown={props.onToggleLockdown} onPick={(m) => void pickMode(m)} onOpen={onOpen} row={row} onElevated={(level) => void patch({ elevatedLevel: level })} />
            </section>
            <section className="c-tune-section"><h3>Thread</h3>
              <div className="c-tune-line"><span>Start as a job<small>Your next message gets its own card and progress.</small></span><button type="button" aria-pressed={nextAsJob} onClick={() => setNextAsJob((v) => !v)}>{nextAsJob ? "On" : "Off"}</button></div>
            </section>
            <section className="c-tune-section"><h3>Status</h3>
              {bg.jobs.filter((job) => job.running).length ? <div className="c-tune-line"><span>{bg.jobs.filter((job) => job.running).length} in the background</span><button type="button" onClick={() => { setMenu(null); props.onOpenConversation?.(bg.jobs.find((job) => job.running)?.key ?? ""); }}>Open</button></div> : null}
              <div className="c-tune-line"><span>{working ? "Working" : props.offline ? "Offline" : "Ready"}<small>{props.offline ? "The engine is not connected" : `Connected to ${props.connectionTarget || "this computer"}’s Branch`}</small></span></div>
            </section>
            <section className="c-tune-section"><h3>Usage</h3>
              <div className="c-tune-line"><span>{cost !== undefined ? `$${cost.toFixed(2)} in this conversation` : "No usage recorded for this conversation"}{accountEmail ? <small>{accountEmail}</small> : null}</span><button type="button" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => { setMenu(null); onOpen?.("settings/usage"); }}>Details</button></div>
            </section>
          </Popover>
        ) : null}
        {searching ? (
          <HistorySearch
            anchor={box}
            engine={engine}
            sent={history.sentList()}
            draft={draft.text}
            onPreview={draft.setText}
            onDone={(t) => {
              setSearching(false);
              draft.setText(t);
              requestAnimationFrame(() => box.current?.focus());
            }}
          />
        ) : null}
      </form>
      {picture ? <PictureDialog onClose={() => setPicture(false)} onMake={(words) => deliver(`Make a picture: ${words}`, [], [])} /> : null}
      {photo ? <PhotoDialog onClose={() => setPhoto(false)} onUse={(f) => void draft.addFiles([f], "file")} onUpload={() => fileInput.current?.click()} /> : null}
    </div>
  );
}

function ToolButton({ refEl, icon, label, tip, open, onClick, disabled, testId }: {
  refEl: React.RefObject<HTMLButtonElement | null>;
  icon: "plus" | "plug";
  label: string;
  tip?: string;
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button ref={refEl} type="button" className="c-btn" data-testid={testId} aria-label={label} title={tip ?? label} aria-expanded={open} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** The no-model line (DESIGN-SPEC §4.2.9, §4.3.1 States; DECISIONS.md item 36), with its two links. */
function NoModelLine({ onOpen }: { onOpen?: (target: OpenTarget) => void }) {
  return (
    <p className="c-nomodel" data-testid="no-model">
      Trunks can’t answer until a model is connected.{" "}
      <button type="button" className="c-link" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => onOpen?.("settings/accounts/add")}>Add an account</button>
    </p>
  );
}
