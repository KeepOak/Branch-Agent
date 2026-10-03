// The person's own conversation choices, as Settings keeps them (claude/win-set1): General › The conversation in
// users.prefs ("conversation.*"), and Appearance's reading rows inside users.prefs "ui.window.look" (also kept in
// this window's "branch.look" copy, and announced with the "branch:look-change" window event).
import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";

export type ConversationPrefs = {
  vimKeys: boolean;
  messageTimes: "hover" | "always" | "never";
  sendWith: "enter" | "ctrl";
  taskProgress: boolean;
  taskProgressStarts: "open" | "folded";
  msgLook: "bubbles" | "full";
  dir: "auto" | "rtl" | "ltr";
  math: boolean;
  scroll: "scrolling" | "always";
  codeCol: "theme" | "github" | "monokai" | "solarized" | "tm";
};

export const DEFAULT_PREFS: ConversationPrefs = {
  vimKeys: false,
  messageTimes: "hover",
  sendWith: "enter",
  taskProgress: true,
  taskProgressStarts: "open",
  msgLook: "bubbles",
  dir: "auto",
  math: true,
  scroll: "scrolling",
  codeCol: "theme",
};

const KEYS = ["conversation.vimKeys", "conversation.messageTimes", "conversation.sendWith", "conversation.taskProgress", "conversation.taskProgressStarts"] as const;
const LOOK = "ui.window.look";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

/** Reads the stored values, falling back to each default for anything missing or unknown. */
export function readPrefs(entries: Record<string, unknown>, look: Record<string, unknown>): ConversationPrefs {
  const d = DEFAULT_PREFS;
  return {
    vimKeys: entries["conversation.vimKeys"] === true,
    messageTimes: pick(entries["conversation.messageTimes"], ["hover", "always", "never"], d.messageTimes),
    sendWith: pick(entries["conversation.sendWith"], ["enter", "ctrl"], d.sendWith),
    taskProgress: entries["conversation.taskProgress"] !== false,
    taskProgressStarts: pick(entries["conversation.taskProgressStarts"], ["open", "folded"], d.taskProgressStarts),
    msgLook: pick(look.msgLook, ["bubbles", "full"], d.msgLook),
    dir: pick(look.dir, ["auto", "rtl", "ltr"], d.dir),
    math: look.math !== false,
    scroll: pick(look.scroll, ["scrolling", "always"], d.scroll),
    codeCol: pick(look.codeCol, ["theme", "github", "monokai", "solarized", "tm"], d.codeCol),
  };
}

function localLook(): Record<string, unknown> {
  try {
    return rec(rec(JSON.parse(localStorage.getItem("branch.look") ?? "{}")).look);
  } catch {
    return {}; // storage blocked or damaged: the defaults stand until the engine answers
  }
}

/** The choices, kept current from users.prefs.changed and the Appearance page's branch:look-change. */
export function useConversationPrefs(engine: WindowEngine | undefined): ConversationPrefs {
  const [entries, setEntries] = useState<Record<string, unknown>>({});
  const [look, setLook] = useState<Record<string, unknown>>(localLook);
  useEffect(() => {
    if (!engine) return;
    let on = true;
    const load = () =>
      engine.request("users.prefs.get", { keys: [...KEYS, LOOK] }).then(
        (r) => {
          if (!on || rec(r).status !== "ok") return;
          const e = rec(rec(r).entries);
          setEntries(e);
          if (e[LOOK] !== undefined && e[LOOK] !== null) setLook(rec(e[LOOK]));
        },
        (e: unknown) => console.warn("Your conversation choices stay at their defaults: users.prefs.get failed:", e),
      );
    void load();
    const off = engine.onEvent((e) => e.event === "users.prefs.changed" && void load());
    return () => {
      on = false;
      off();
    };
  }, [engine]);
  useEffect(() => {
    const changed = (e: Event) => setLook(rec(rec((e as CustomEvent).detail).look));
    window.addEventListener("branch:look-change", changed);
    return () => window.removeEventListener("branch:look-change", changed);
  }, []);
  return readPrefs(entries, look);
}
