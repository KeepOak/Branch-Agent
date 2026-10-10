// Settings › General › The conversation (§4.7.1, Advanced): the person's own choices, kept with their profile through
// users.prefs.get/set so they follow them to every device; "When you send while it works" is the engine's
// messages.queue.mode; "Ask before deleting" is this device's own choice, the one the delete dialog reads.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { askBeforeDelete } from "../../../shell/ConfirmDelete";
import { Ctl, LinkBtn, Sec, Seg, Switch, useConfig, useSaveRunner, useSaved } from "../kit";

/** The person's own conversation choices in users.prefs (the composer and thread read these keys). */
export const GENERAL_PREFS = {
  vimKeys: "conversation.vimKeys",
  messageTimes: "conversation.messageTimes",
  sendWith: "conversation.sendWith",
  taskProgress: "conversation.taskProgress",
  taskProgressStarts: "conversation.taskProgressStarts",
} as const;
const P = GENERAL_PREFS;
const DEFAULTS: RecordValue = { [P.vimKeys]: false, [P.messageTimes]: "hover", [P.sendWith]: "enter", [P.taskProgress]: true, [P.taskProgressStarts]: "open" };
const NO_PERSON = "Sign in as yourself on this Branch to keep your own choices.";
const ASK_KEY = "branch.askBeforeDelete";
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** users.prefs for this page's keys: the stored value (or the default), a save that puts it back if refused. */
export function usePrefs(engine: WindowEngine) {
  const res = useResource<RecordValue>(engine, "users.prefs.get", { keys: Object.values(P) });
  const { reload } = res;
  const [mine, setMine] = useState<RecordValue>({});
  const revisions = useRef<Record<string, number>>({});
  const run = useSaveRunner();
  useEffect(() => engine.onEvent((e) => { if (e.event === "users.prefs.changed") void reload().then(() => setMine({})); }), [engine, reload]);
  const ok = res.data?.status === "ok";
  const stored: RecordValue = { ...(ok ? record(res.data?.entries) : {}), ...mine };
  const get = (key: string): unknown => stored[key] ?? DEFAULTS[key];
  const set = useCallback((key: string, value: unknown) => {
    const revision = (revisions.current[key] ?? 0) + 1;
    revisions.current[key] = revision;
    setMine((m) => ({ ...m, [key]: value }));
    void run(async () => {
      const r = record(await engine.request("users.prefs.set", { entries: { [key]: value } }));
      if (r.status === "conflict") throw new Error("It changed on another device. Try again.");
      if (r.status !== "ok") throw new Error(NO_PERSON);
    }).then((saved) => { if (!saved && revisions.current[key] === revision) setMine((m) => { const next = { ...m }; delete next[key]; return next; }); });
  }, [engine, run]);
  const off = res.loading ? undefined : res.error ? visible(res.error) : ok ? undefined : NO_PERSON;
  return { get, set, off, loading: res.loading, changed: (key: string) => stored[key] != null && stored[key] !== DEFAULTS[key] };
}

/** A sub-line, where the choice is kept, and "Back to default" once it differs. */
function Own({ text, device, reset }: { text: string; device?: boolean; reset?: () => void }) {
  return <>{text} <span className="kept-k">{device ? "This device only." : "Follows you on every device."}</span>{reset ? <> <LinkBtn onClick={reset}>Back to default</LinkBtn></> : null}</>;
}

const TIMES = [{ id: "hover", label: "On hover" }, { id: "always", label: "Always" }, { id: "never", label: "Never" }];
const SEND = [{ id: "enter", label: "Enter" }, { id: "ctrl", label: MAC ? "⌘ Enter" : "Ctrl Enter" }];
const FOLD = [{ id: "open", label: "Open" }, { id: "folded", label: "Folded" }];

export function Conversation({ engine }: { engine: WindowEngine }) {
  const prefs = usePrefs(engine);
  const { get, set, off, loading } = prefs;
  const back = (key: string) => (prefs.changed(key) ? () => set(key, null) : undefined);
  const progress = get(P.taskProgress) !== false;
  return (
    <Sec personal title="The conversation">
      <Ctl title="Vim keys in the message box" sub={<Own text="Normal and insert modes, for people who type that way." reset={back(P.vimKeys)} />} off={off}>
        <Switch checked={get(P.vimKeys) === true} label="Vim keys in the message box" disabled={loading} onChange={(v) => set(P.vimKeys, v)} />
      </Ctl>
      <Ctl title="Message times" sub={<Own text="When a message was sent, and when a task started and ended." reset={back(P.messageTimes)} />} off={off}>
        <Seg label="Message times" value={String(get(P.messageTimes))} options={TIMES} disabled={loading} onChange={(v) => set(P.messageTimes, v)} />
      </Ctl>
      <QueueMode engine={engine} />
      <Ctl title="Send with" sub={<Own text="Enter sends and Shift Enter adds a line, or the other way round." reset={back(P.sendWith)} />} off={off}>
        <Seg label="Send with" value={String(get(P.sendWith))} options={SEND} disabled={loading} onChange={(v) => set(P.sendWith, v)} />
      </Ctl>
      <Ctl title="Task progress above the message box" sub={<Own text="The task’s plan and ticked steps while it runs. Hiding it doesn’t stop anything." reset={back(P.taskProgress)} />} off={off}>
        <Switch checked={progress} label="Task progress above the message box" disabled={loading} onChange={(v) => set(P.taskProgress, v)} />
      </Ctl>
      <Ctl title="Task progress starts" sub={<Own text="On a phone it always starts folded." reset={back(P.taskProgressStarts)} />} off={off}>
        <Seg label="Task progress starts" value={String(get(P.taskProgressStarts))} options={FOLD} disabled={loading || !progress} onChange={(v) => set(P.taskProgressStarts, v)} />
      </Ctl>
      <AskBeforeDelete />
    </Sec>
  );
}

/** messages.queue.mode: steer (the engine's default), followup, collect or interrupt; "Put back" clears it. */
const FOLLOW = [{ id: "steer", label: "Steer it now" }, { id: "followup", label: "Wait in line" }, { id: "collect", label: "Gather into one" }, { id: "interrupt", label: "Stop and start over" }];
function QueueMode({ engine }: { engine: WindowEngine }) {
  const cfg = useConfig(engine);
  const path = "messages.queue.mode";
  const raw = cfg.get(path);
  const mode = typeof raw === "string" ? raw : "steer";
  // A plain title keeps the row's pin; the "Changed here" note only shows once the engine's default is changed.
  const title: ReactNode = mode === "steer" ? "When you send while it works" : <>When you send while it works<span className="changed-k">Changed here <LinkBtn onClick={() => void cfg.set(path, null)}>Put back</LinkBtn></span></>;
  return (
    <Ctl title={title} id="When you send while it works" sub={<Own text="What a message you send during a task does. Ctrl Enter does the other one for that message." />}>
      <Seg label="When you send while it works" value={mode} options={FOLLOW} disabled={cfg.loading} onChange={(v) => void cfg.set(path, v)} />
    </Ctl>
  );
}

/** The delete dialog's own choice on this device (its "Don't ask me again" writes the same key). */
function AskBeforeDelete() {
  const [on, setOn] = useState(askBeforeDelete);
  const report = useSaved();
  const save = (v: boolean) => {
    try {
      if (v) localStorage.removeItem(ASK_KEY);
      else localStorage.setItem(ASK_KEY, "0");
      setOn(v);
      report.saved();
    } catch (error) {
      report.failed(error instanceof Error ? error.message : "This device didn’t keep the choice.");
    }
  };
  return (
    <Ctl title="Ask before deleting a conversation" sub={<Own device text="Applies to deleting from the list." reset={on ? undefined : () => save(true)} />}>
      <Switch checked={on} label="Ask before deleting a conversation" onChange={save} />
    </Ctl>
  );
}
