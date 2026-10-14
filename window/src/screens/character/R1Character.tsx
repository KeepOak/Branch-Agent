import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WindowEngine } from "../../connect/engine";
import type { SessionSnapshot } from "../../connect/session";
import { CharacterPanel } from "../../face/CharacterPanel";
import { agentState, DONE_MS, TALK_MS, type AgentState } from "../../face/agentState";
import { lookStore } from "../../places/settings/set1/appearance-store";
import "./r1-character.css";

const SHOWN_KEY = "branch.characterShown";
/** Classic keeps the card 96px above its column's foot and 12px over the composer; the bounds box lines those up. */
const PANEL_FOOT = 84;

function readShown(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) !== "0";
  } catch {
    return true;
  }
}

/**
 * Whether the character is shown: the key Classic and Settings › Appearance ("Show the agent beside the conversation")
 * already share, so hiding it in either window hides it in the other. Follows "branch:look-change" without a reload.
 */
export function useR1CharacterShown(engine: WindowEngine): readonly [boolean, (on: boolean) => void] {
  const [shown, setShown] = useState(readShown);
  useEffect(() => {
    const reread = () => setShown(readShown());
    window.addEventListener("branch:look-change", reread);
    return () => window.removeEventListener("branch:look-change", reread);
  }, []);
  const set = useCallback((on: boolean) => {
    try { localStorage.setItem(SHOWN_KEY, on ? "1" : "0"); } catch { /* storage blocked: the choice lasts for this window only */ }
    setShown(on);
    // The same saved choice Classic writes; an engine that can't save it keeps the choice in this window.
    try { void Promise.resolve(lookStore(engine).set("agentShown", on)).catch(() => undefined); } catch { /* not saved */ }
  }, [engine]);
  return [shown, set] as const;
}

/** The clock the face reads, ticking when a finished run's Explaining and Done moments end (as Classic's). */
function useNow(doneAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setNow(Date.now());
    if (!doneAt) return;
    const timers = [TALK_MS, DONE_MS].map(delay => setTimeout(() => setNow(Date.now()), Math.max(0, doneAt + delay - Date.now()) + 50));
    return () => timers.forEach(clearTimeout);
  }, [doneAt]);
  return now;
}

/** The open conversation's face state, read from the engine's run as Classic does; a pending approval waits for you. */
export function r1CharacterState(snapshot: Pick<SessionSnapshot, "live" | "liveRunId" | "history" | "doneAt" | "lastActivityAt">, waiting: number, now: number): AgentState {
  if (waiting > 0) return "wait";
  return agentState({ live: snapshot.live, running: Boolean(snapshot.liveRunId), history: snapshot.history, endedAt: snapshot.doneAt ?? null, now, lastActivityAt: snapshot.lastActivityAt ?? null });
}

type Props = {
  name: string;
  snapshot: Pick<SessionSnapshot, "live" | "liveRunId" | "history" | "doneAt" | "lastActivityAt">;
  waiting: number;
  onHide: () => void;
  onShow: () => void;
  onOpenTrunk: () => void;
  onChangePet: () => void;
};

/**
 * The Classic character panel (the Trunk card: face, name, state, its menu, drag and corners), re-hosted unchanged in
 * the R1 frame (parity row 19). Only this wrapper is R1: a clear glass surface (README item 48) whose name and state sit
 * on small frosted pills, and a bounds box inside the conversation column, between the header and the composer, that the
 * Classic card measures in place of Classic's column.
 */
export function R1Character({ name, snapshot, waiting, onHide, onShow, onOpenTrunk, onChangePet }: Props) {
  const now = useNow(snapshot.doneAt ?? null);
  const [conversation, setConversation] = useState<HTMLElement | null>(null);
  const [bounds, setBounds] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setConversation(document.querySelector<HTMLElement>(".r1-conversation")); }, []);
  useLayoutEffect(() => {
    if (!conversation) return;
    const slot = () => conversation.querySelector<HTMLElement>(".r1-composer-slot");
    const fit = () => conversation.style.setProperty("--r1-character-foot", `${(slot()?.offsetHeight ?? 0) - PANEL_FOOT}px`);
    fit();
    if (typeof ResizeObserver !== "function") return () => conversation.style.removeProperty("--r1-character-foot");
    const observer = new ResizeObserver(fit);
    const el = slot();
    if (el) observer.observe(el);
    return () => { observer.disconnect(); conversation.style.removeProperty("--r1-character-foot"); };
  }, [conversation]);
  const state = r1CharacterState(snapshot, waiting, now);
  // The Classic card measures its column with a ResizeObserver; a host without one keeps the card unplaced, as Classic would.
  const column = typeof ResizeObserver === "function" ? bounds : null;
  return <div className="r1-character g-clear">
    {conversation ? createPortal(<div className="r1-character-bounds" ref={setBounds} aria-hidden="true" />, conversation) : null}
    <CharacterPanel name={name} state={state} onClose={onHide} onShow={onShow} onOpenTrunk={onOpenTrunk} onChangePet={onChangePet} column={column} />
  </div>;
}
