// Wires each hover-bar action to its engine method and keeps the dialogs they open (DESIGN-SPEC §4.2.6).
import { useEffect, useState, type ReactNode } from "react";
import { askAgain, askedBy, branchFrom, editAndSend, nextAsk, setReaction } from "./actions";
import { copyText, type ThreadContextValue } from "./context";
import { BranchDialog, EditDialog, LookInside } from "./dialogs";
import type { Act, HoverActions } from "./HoverBar";
import { turnOf } from "./layout";
import { isInternalStep } from "./internal-steps";
import { readAloud, readingKey, stopReading } from "./read-aloud";
import type { Block } from "./model";

export type ReplyTarget = { entryId: string; name: string; text: string };

type Options = {
  onReload?: () => void;
  onOpenSession?: (key: string) => void;
  onReply?: (target: ReplyTarget) => void;
  onStartTopic?: (afterMessageId: string) => void;
  applyReaction: (messageId: string, raw: unknown) => void;
};

type DialogState =
  | { kind: "edit"; entryId: string; text: string }
  | { kind: "branch"; entryId: string }
  | { kind: "inspect"; block: Extract<Block, { kind: "text" }>; turn: Block[] }
  | null;

const NO_ENGINE = "Not connected to the engine yet.";
const NO_REPLY = "Replying to one message needs the composer's reply chip, which isn't in this window yet.";

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function useMessageActions(ctx: ThreadContextValue, opts: Options): { actionsFor: (blocks: readonly Block[], index: number) => HoverActions | null; dialog: ReactNode } {
  const { engine, name, toast, running } = ctx;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [reading, setReading] = useState<string | null>(readingKey());
  const [undoContext, setUndoContext] = useState<string | null>(null);
  useEffect(() => {
    if (!undoContext) return;
    const timer = setTimeout(() => setUndoContext(null), 6000);
    return () => clearTimeout(timer);
  }, [undoContext]);
  const busy = running ? `Not while ${name} is working.` : null;
  // A row that is blocked only while the Trunk works says so (waiting), so the menu keeps it visible and explains it.
  const act = (run: () => void, reason: string | null): Act => {
    const disabled = engine ? reason : NO_ENGINE;
    return { run, disabled, ...(disabled && reason === busy ? { waiting: true } : {}) };
  };
  const fail = (e: unknown) => toast(errorText(e));
  const reload = () => opts.onReload?.();

  const retry = (userEntryId: string) => {
    if (!engine) return;
    // With the window's own send the new turn shows live; reading history again mid-turn would draw it twice.
    askAgain(engine, userEntryId).then(engine.send ? undefined : reload, fail);
  };
  const react = (entryId: string | undefined, emoji: string, remove = false) => {
    if (!engine || !entryId) return;
    setReaction(engine, entryId, emoji, remove).then((raw) => opts.applyReaction(entryId, raw), fail);
  };
  const setContext = (entryId: string, exclude: boolean) => {
    if (!engine) return;
    engine.request("session.context.set", { sessionKey: engine.sessionKey, ...(engine.agentId ? { agentId: engine.agentId } : {}), messageId: entryId, exclude })
      .then(() => { reload(); setUndoContext(exclude ? null : entryId); if (exclude) toast("Left out of context."); }, fail);
  };

  const actionsFor = (blocks: readonly Block[], index: number): HoverActions | null => {
    const block = blocks[index];
    if (block.kind !== "text" && block.kind !== "user") return null;
    const entryId = block.meta?.entryId;
    const isReply = block.kind === "text";
    const asked = isReply ? askedBy(blocks, index) : null;
    const branchAt = isReply ? nextAsk(blocks, index)?.meta?.entryId : entryId;
    const userText = block.kind === "user" ? block.text : "";
    return {
      copy: { run: () => void copyText(block.text, toast), disabled: null },
      // Rows that can never apply to this message are left out (no engine id, no earlier message to ask again).
      ...(isReply && asked?.meta?.entryId ? { retry: act(() => asked.meta?.entryId && retry(asked.meta.entryId), busy) } : {}),
      ...(!isReply && entryId ? { edit: act(() => setDialog({ kind: "edit", entryId, text: userText }), busy) } : {}),
      reply: { run: () => entryId && opts.onReply?.({ entryId, name: isReply ? name : "you", text: block.text }), disabled: opts.onReply && entryId ? null : NO_REPLY },
      react: (emoji, remove) => react(entryId, emoji, remove),
      reactDisabled: !engine ? NO_ENGINE : !entryId ? "This message has no engine id yet." : null,
      ...(isReply ? { inspect: act(() => setDialog({ kind: "inspect", block, turn: turnOf(blocks, index) }), null) } : {}),
      ...(branchAt ? { branch: act(() => setDialog({ kind: "branch", entryId: branchAt }), busy) } : {}),
      ...(entryId ? { context: { ...act(() => setContext(entryId, !block.meta?.excluded), busy), excluded: block.meta?.excluded === true } } : {}),
      ...(opts.onStartTopic && entryId ? { startConversation: { run: () => opts.onStartTopic?.(entryId), disabled: null } } : {}),
      ...(isReply && block.text.trim()
        ? {
            read: {
              reading: reading === block.key,
              disabled: null,
              run: () => {
                if (reading === block.key) {
                  stopReading();
                  setReading(null);
                  return;
                }
                setReading(block.key);
                void readAloud(engine, block.key, block.text, () => setReading((r) => (r === block.key ? null : r)));
              },
            },
          }
        : {}),
    };
  };

  const close = () => setDialog(null);
  let node: ReactNode = null;
  if (dialog?.kind === "edit" && engine) {
    node = <EditDialog text={dialog.text} onClose={close} onSend={async (words) => { await editAndSend(engine, dialog.entryId, words); if (!engine.send) reload(); }} />;
  } else if (dialog?.kind === "branch" && engine) {
    node = (
      <BranchDialog
        onClose={close}
        onBranch={async (o) => {
          const made = await branchFrom(engine, dialog.entryId, o);
          if (opts.onOpenSession && made.sessionKey) opts.onOpenSession(made.sessionKey);
        }}
      />
    );
  } else if (dialog?.kind === "inspect") {
    const done = dialog.turn.find((b): b is Extract<Block, { kind: "done" }> => b.kind === "done");
    node = <LookInside inspect={{ meta: dialog.block.meta, durationMs: done?.durationMs, steps: dialog.turn.filter((b) => (b.kind === "step" && !isInternalStep(b)) || b.kind === "approval").length }} onClose={close} />;
  }
  return { actionsFor, dialog: <>{node}{undoContext ? <div className="context-undo" role="status">Back in context. <button type="button" onClick={() => { setContext(undoContext, true); setUndoContext(null); }}>Undo</button></div> : null}</> };
}
