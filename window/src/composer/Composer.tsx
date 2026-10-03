// The composer (DESIGN-SPEC §4.3): the message box, +, the plug, the model and mode chips, voice and Send/Stop,
// the dock row above it and the menus, all wired to the engine through the shared handle (connect/engine.ts).
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { PASTED_TEXT_CHIP_CHARS } from "./attachments";
import { DockRow, type Goal } from "./DockRow";
import { isAdmin, num, rec, str, type SendExtras, type WindowEngine } from "./engine";
import { Icon, StopMark } from "./icons";
import { replaceToken } from "./mention";
import { isEngineMode, modeName, nextMode, type EngineMode } from "./mode";
import { chipLabel, currentModelRef, currentThinking } from "./model";
import { ModelMenu } from "./ModelMenu";
import { Logo } from "../places/settings/set1/service";
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
import { vimKey, type VimMode } from "./vim";
import { useDraft } from "./useDraft";
import { useDrawer, type Pick } from "./useDrawer";
import { useHistoryKeys } from "./useHistoryKeys";
import { HistorySearch } from "./HistorySearch";
import { diffContext, folderContext } from "./context";
import { registerInputCheckpoint, updateBlocked, useUpdateBarrier } from "../connect/update-barrier";
import { useWaitingLine } from "./useWaitingLine";
import { DictationStrip, TALK_EVENT, useDictation, useVoiceCatalog, useVoiceNote, VoiceNoteStrip, VoiceScreen } from "./VoiceParts";
import "./composer.css";

type Props = {
  name: string;
  working: boolean;
  disabled: boolean;
  onSend: (text: string, extras?: SendExtras) => Promise<void>;
  onStop: () => void;
  engine?: WindowEngine;
  sessionKey?: string | null;
  onReload?: () => void;
  onToast?: (text: string) => void;
  onOpen?: (target: OpenTarget) => void;
  onOpenConversation?: (key: string) => void;
  replyTo?: Reply | null;
  onClearReply?: () => void;
  offline?: boolean;
  /** Drawn just above the message box, under the dock row: the waiting question (§4.2.2 "Question above the message box"). */
  above?: ReactNode;
  /** The plan's progress for the dock row's "1 of 4" chip. */
  plan?: { done: number; total: number; steps: { step: string; status: string }[] } | null;
  /** In a room: "Message the room · @ to call a Trunk" (rooms/, §4.3.1); else "Message <Trunk>". */
  placeholder?: string;
};

type Menu = "plus" | "plug" | "model" | "mode" | null;

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
  const { name, working, onSend, onStop, engine, onToast, onOpen } = props;
  const updating = useUpdateBarrier();
  const disabled = props.disabled || updating;
  const submitting = useRef<Promise<void> | null>(null);
  useEffect(() => registerInputCheckpoint(async () => { await submitting.current; }), []);
  const conv = useConversation(engine);
  const draft = useDraft(engine?.sessionKey ?? null, engine?.attachmentPolicy);
  const [menu, setMenu] = useState<Menu>(null);
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
  const anchors = { plus: useRef<HTMLButtonElement>(null), plug: useRef<HTMLButtonElement>(null), model: useRef<HTMLButtonElement>(null), mode: useRef<HTMLButtonElement>(null) };

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
  const currentRef = currentModelRef(row, conv.defaults);
  const current = conv.models.find((m) => m.ref === currentRef || m.id === currentRef);
  const thinking = currentThinking(row, conv.defaults);
  // No model set up: the engine names a default model but none is connected (models.list has none usable), or none at all.
  const noModel = hasNoModel(conv, currentRef);
  const admin = isAdmin(engine?.scopes ?? []);
  const mode: EngineMode | null = isEngineMode(row.permissionMode) ? row.permissionMode : null;
  const asSet = isEngineMode(conv.trunk?.defaultMode) ? (conv.trunk?.defaultMode as EngineMode) : null;
  const queueMode = str(row.effectiveQueueMode);
  const trunkName = conv.trunk?.name || name;
  const toast = useCallback((text: string) => onToast?.(text), [onToast]);

  const deliver = useCallback(
    (text: string, files = draft.files, people = draft.people, queue?: string) => onSend(text, { ...buildExtras(text, files, people, queue, props.replyTo), idempotencyKey: crypto.randomUUID(), sessionKey: engine?.sessionKey ?? undefined, sessionId: str(row.sessionId) || undefined }),
    [onSend, draft.files, draft.people, props.replyTo, engine?.sessionKey, row.sessionId],
  );
  const line = useWaitingLine(engine?.sessionKey ?? null, working, Boolean(props.offline) || !conv.loaded, (item, steer) => {
    return onSend(item.text, { ...buildExtras(item.text, item.files, item.people ?? [], steer ? "steer" : undefined, item.reply), idempotencyKey: item.id, sessionId: item.sessionId, sessionKey: engine?.sessionKey ?? undefined }).then(() => {
      if (steer) toast(`Steered ${trunkName}. It picks this up at its next step.`);
    });
  }, { sessionId: str(row.sessionId), read: (inputRunIds) => engine!.request("chat.history", { sessionKey: engine!.sessionKey, inputRunIds, limit: 1 }) });
  const reconcileQueued = line.reconcile;
  useEffect(() => engine?.onEvent(({ event }) => { if (event === "chat" || event === "session.message" || event === "sessions.changed") void reconcileQueued(); }), [engine, reconcileQueued]);
  const bg = useBackground(engine, conv.trunkId);
  const levels = current?.levels ?? [];
  const drawer = useDrawer(engine, conv.trunks, levels, useMemo(() => ({ think: thinking }), [thinking]));
  const view = draft.text === dismissed ? null : drawer.view(draft.text, caret);
  const history = useHistoryKeys(engine, draft.text, draft.setText);

  const patch = async (fields: Record<string, unknown>) => {
    const err = await conv.patch(fields);
    setProblem(err);
    return err;
  };
  const pickMode = async (next: EngineMode | null) => {
    setMenu(null);
    if ((await patch({ permissionMode: next })) === null) toast(`${next ? modeName(next) : `As set · ${modeName(asSet)}`} in this conversation.`);
  };
  const runBackground = async (text: string) => {
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
    if (updateBlocked() || submitting.current || draft.preparing) return;
    const sent = draft.snapshot();
    const plan = planSend(draft.text, draft.files.length > 0, working, queueMode, alt);
    if (plan.kind === "nothing") return;
    if (plan.kind === "stop") {
      onStop();
      draft.clear();
      return;
    }
    if (plan.kind === "background") {
      void runBackground(plan.text);
      return;
    }
    if (noModel && plan.kind !== "command") return;
    if (plan.kind === "wait") {
      if (!line.add(draft.text.trim(), draft.files, { people: draft.people, reply: props.replyTo })) return;
      history.record(draft.text.trim());
      draft.clear();
      props.onClearReply?.();
    } else {
      const job = Promise.resolve().then(() => onSend(draft.text.trim(), { ...buildExtras(draft.text.trim(), draft.files, draft.people, plan.kind === "send" ? plan.queueMode : undefined, props.replyTo), idempotencyKey: crypto.randomUUID(), sessionKey: engine?.sessionKey ?? undefined })).then(() => {
        history.record(sent.text.trim());
        draft.clearSent(sent);
        props.onClearReply?.();
        if (plan.kind === "send" && plan.queueMode === "steer") toast(`Steered ${trunkName}. It picks this up at its next step.`);
      }).catch((error: unknown) => { setProblem(error instanceof Error ? error.message : "Delivery not confirmed. Your draft is kept here."); }).finally(() => { submitting.current = null; });
      submitting.current = job;
    }
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
    else next = replaceToken(draft.text, p.token, p.kind === "skill" ? `/${p.name}` : `@${p.name}`);
    if (p.kind === "person") draft.addPerson({ profileId: p.profileId, name: p.name });
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
      const next = nextMode(mode ?? asSet, admin);
      if (next) void pickMode(next);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
      e.preventDefault();
      setMenu("model");
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

  /** A new temporary conversation with this Trunk (sessions.create incognito), opened in its place. */
  const startTemporary = async () => {
    if (!engine || !props.onOpenConversation) return;
    try {
      const made = rec(await engine.request("sessions.create", { incognito: true, ...(conv.trunkId ? { agentId: conv.trunkId } : {}) }));
      if (str(made.key)) props.onOpenConversation(str(made.key));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const hasDraft = draft.text.trim().length > 0 || draft.files.length > 0;
  const stopMode = working && !hasDraft;
  const ready = hasDraft && !disabled && draft.preparing === 0 && (!noModel || draft.text.trim().startsWith("/"));
  const cost = num(row.estimatedCostUsd);
  const temporary = row.incognito === true;

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
      {problem ? <p className="c-note bad" role="alert">{problem}</p> : null}
      {line.error ? <p className="c-note bad" role="alert">{line.error}</p> : null}
      {draft.note ? <p className="c-note">{draft.note}</p> : null}
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
          try { await deliver(text, [], [], "steer"); }
          catch (error) { setProblem(error instanceof Error ? error.message : "Delivery not confirmed."); return false; }
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
          {cost !== undefined && cost > 0 && current && !current.local ? (
            <span className="c-cost" title={`What this conversation has cost so far on ${current.name}. Details in Settings › Data & usage.`}>
              ${cost < 1 ? cost.toFixed(2) : Math.round(cost)} so far
            </span>
          ) : null}
        </span>
        {engine && !noModel ? (
          <button ref={anchors.model} type="button" className="c-chipb" data-testid="model-chip" aria-expanded={menu === "model"} title="Model and how long it thinks" onClick={() => setMenu(menu === "model" ? null : "model")}>
            <Logo id={current?.provider ?? currentRef.split("/")[0] ?? ""} size={18} />
            <span className="c-chipw">{chipLabel(current?.name ?? currentRef.split("/").pop() ?? "", thinking)}</span>
            {str(row.activeModel) && str(row.activeModel) !== str(row.model) ? (
              <span title={`${current?.name ?? str(row.model)} isn't answering, so ${str(row.activeModel)} is standing in.`}><Icon name="retry" size={13} /></span>
            ) : null}
            {row.fastMode === true || row.fastMode === "ultrafast" ? <Icon name="bolt" size={13} /> : null}
            <Icon name="chev" size={14} />
          </button>
        ) : null}
        {engine ? (
          <button ref={anchors.mode} type="button" className={`c-chipb${(mode ?? asSet) === "full" ? " bad" : ""}`} data-testid="mode-chip" aria-expanded={menu === "mode"} title="How much it may do in this conversation (Shift+Tab)" onClick={() => setMenu(menu === "mode" ? null : "mode")}>
            <Icon name={(mode ?? asSet) === "full" ? "unlock" : (mode ?? asSet) === "read-only" ? "eye" : (mode ?? asSet) === "workspace" ? "spark" : "shield"} size={15} />
            <span className="c-chipw">{modeName(mode ?? asSet) || "As set"}</span>
            <Icon name="chev" size={14} />
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
            const listing = folderContext([...(e.target.files ?? [])].map((f) => f.webkitRelativePath || f.name));
            if (listing) draft.addPastedText(listing);
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
            onPhoto={() => setPhoto(true)}
            onPicture={noModel ? undefined : () => setPicture(true)}
            onInsert={(t) => {
              const next = t === "@" || t === "/" ? `${draft.text}${draft.text && !draft.text.endsWith(" ") ? " " : ""}${t}` : t;
              draft.setText(next);
              setCaret(next.length);
              setDismissed(null);
              requestAnimationFrame(() => box.current?.focus());
            }}
            onBackground={() => void runBackground(draft.text)}
            onOpen={onOpen}
            temporary={temporary}
            onTemporary={engine && props.onOpenConversation ? () => void startTemporary() : undefined}
            onVoiceNote={typeof MediaRecorder !== "undefined" && navigator.mediaDevices ? () => void note.start() : undefined}
          />
        ) : null}
        {menu === "plug" && engine ? (
          <PlugMenu anchor={anchors.plug} onClose={() => setMenu(null)} engine={engine} row={row} trunkName={trunkName} isAdmin={admin} patch={patch} onToast={onToast} onOpen={onOpen} />
        ) : null}
        {menu === "model" ? (
          <ModelMenu
            anchor={anchors.model}
            onClose={() => setMenu(null)}
            models={conv.models}
            loading={conv.modelsLoading}
            error={conv.modelsError}
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
          />
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
        {menu === "mode" ? <ModeMenu anchor={anchors.mode} onClose={() => setMenu(null)} mode={mode} asSet={asSet} canSelectFull={admin} onPick={(m) => void pickMode(m)} onOpen={onOpen} row={row} onElevated={(level) => void patch({ elevatedLevel: level })} /> : null}
      </form>
      {picture ? <PictureDialog onClose={() => setPicture(false)} onMake={(words) => { void deliver(`Make a picture: ${words}`, [], []).catch((error: unknown) => setProblem(error instanceof Error ? error.message : "Delivery not confirmed.")); }} /> : null}
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
      Please{" "}
      <button type="button" className="c-link" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => onOpen?.("settings/models")}>connect a model</button>, or{" "}
      <button type="button" className="c-link" disabled={!onOpen} title={onOpen ? undefined : NO_ROUTE} onClick={() => onOpen?.("local-model-setup")}>click here</button> to set up a local model.
    </p>
  );
}
