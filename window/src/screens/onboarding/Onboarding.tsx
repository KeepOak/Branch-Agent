// The R1 onboarding card (HANDOFF R1-07, preview item 37 `draw()`): a centred clear-glass card at 1440 (README item 48:
// its text and controls sit on frosted pills), full screen with a sticky footer at 390. Progress dots, the step, Back /
// primary, and "Set up by talking" (step 1 only) and "Set up later". Esc is Set up later. Each step's engine call happens in
// the step that owns it; Meet them creates the picked Trunks and lands in the first conversation (finish.ts).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { readListedTemplates, type ListedTemplate } from "../seedbank/templates";
import { createPicked, greet, readDefaultTrunk, recordOnboarding, saveDisplayName, startSetupTalk, type DefaultTrunk, type Made } from "./finish";
import { FirstTrunk } from "./FirstTrunk";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { configStore } from "../../places/settings/config-store";
import { errorText } from "../../places/settings/adapter";
import { Models } from "./Models";
import { ModeStep } from "./ModeStep";
import { clampStep, freshState, helloOk, LAST_STEP, MODES, mainSessionOf, picked, primary, STEPS, togglePick, WAITS_FOR, type OnboardingState } from "./model";
import { Welcome, WhereSheet } from "./Welcome";
import "./onboarding.css";

export type OnboardingProps = {
  engine: WindowEngine;
  startAt?: number;
  /** Set up later (and Esc): the card closes; what was already saved stays saved. */
  onLater: (state: OnboardingState) => void;
  /** Set up by talking: the card started "Setting up Branch" (sessions.create) and hands over its key to open. */
  onTalk?: (sessionKey: string) => void;
  /** Called after "How much it may do" saved, with the answers so far. */
  onAnswered?: (state: OnboardingState) => void;
  /** Meet them finished: the Trunks were made, setup was recorded and the first message went to `sessionKey`. */
  onDone?: (result: { sessionKey: string; made: Made[]; state: OnboardingState }) => void;
};

/** What step 4 reads from the engine: the templates it carries and the default Trunk. Null until (or unless) it answers. */
function useStepFour(engine: WindowEngine, on: boolean) {
  const [listed, setListed] = useState<ListedTemplate[] | null>(null);
  const [def, setDef] = useState<DefaultTrunk | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    engine.request("trunks.template.list", {}).then((v) => { if (live) setListed(readListedTemplates(v)); }, () => { if (live) setListed(null); });
    engine.request("agents.list", {}).then((v) => { if (live) setDef(readDefaultTrunk(v)); }, () => { if (live) setDef(null); });
    return () => { live = false; };
  }, [engine, on]);
  return { listed, def };
}

export function Onboarding({ engine, startAt = 0, onLater, onTalk, onAnswered, onDone }: OnboardingProps) {
  const [s, setS] = useState<OnboardingState>(() => freshState(startAt));
  const [where, setWhere] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [trunkError, setTrunkError] = useState<string | null>(null);
  const [made, setMade] = useState<Made[]>([]);
  const [talking, setTalking] = useState(false), [talkError, setTalkError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  /** Writes the welcome name onto the profile. An empty name, or a connection with no profile, saves nothing. */
  const keepName = async () => {
    if (s.step !== 0 || !s.name.trim()) return true;
    setSaving(true); setNameError(null);
    try {
      await saveDisplayName(engine, s.name);
      return true;
    } catch (e) {
      setNameError(`Couldn’t save your name. ${errorText(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const talk = async () => {
    if (!onTalk || talking) return;
    setTalking(true); setTalkError(null);
    try {
      const key = await startSetupTalk(engine);
      // As Set up later does, so the card doesn't open again; the conversation asks the rest. A failed save only means
      // the card comes back at the next launch.
      await recordOnboarding(engine, s).catch(() => undefined);
      onTalk(key);
    }
    catch (e) { setTalkError(`Couldn’t start that conversation. ${errorText(e)}`); }
    finally { setTalking(false); }
  };
  const go = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<OnboardingState>) => setS((cur) => ({ ...cur, ...patch }));
  const four = useStepFour(engine, s.step === LAST_STEP);
  // Step 4 starts in its text box (the preview focuses #obTextP37); every other step on the primary button.
  useEffect(() => { if (s.step !== LAST_STEP) go.current?.focus({ preventScroll: true }); }, [s.step]);
  const p = primary(s, four.def?.name);
  const meet = async () => {
    setSaving(true); setTrunkError(null);
    try {
      const created = await createPicked(engine, picked(s), four.listed, made);
      setMade(created.made);
      if (created.error) { setTrunkError(created.error); return; }
      const first = created.made[0];
      const target = first ? { agentId: first.agentId, mainKey: four.def?.mainKey ?? "main" } : four.def ? { agentId: four.def.id, mainKey: four.def.mainKey } : null;
      if (!target) { setTrunkError("Couldn’t find your default Trunk. Try again in a moment."); return; }
      await recordOnboarding(engine, s);
      // The greeting is a real model reply, so it waits for a hello that worked. With examples or no model the
      // conversation opens empty: no chat.send that would fail with "Couldn't sign in" (ONBOARDING-PROPOSAL ⑤).
      const sessionKey = helloOk(s.hello) ? await greet(engine, target.agentId, target.mainKey, s.name) : mainSessionOf(target.agentId, target.mainKey);
      onDone?.({ sessionKey, made: created.made, state: s });
    } catch (e) {
      setTrunkError(`Couldn’t start your first conversation. ${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const next = async () => {
    if (!p.ok || saving) return;
    if (s.step < 2) {
      if (!(await keepName())) return;
      set({ step: clampStep(s.step + 1) });
      return;
    }
    if (s.step === LAST_STEP) { await meet(); return; }
    const exec = MODES.find((m) => m.id === s.mode)?.exec;
    if (!exec) return;
    setSaving(true); setModeError(null);
    try {
      // The engine refuses mode beside the older security/ask keys, so those go (as Settings › Permissions saves it).
      await configStore(engine).set("tools.exec", { mode: exec, security: null, ask: null });
      onAnswered?.(s);
      set({ step: LAST_STEP });
    } catch (e) {
      setModeError(`Couldn’t save that. ${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const leave = async () => { if (await keepName()) onLater(s); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || where) return;
    e.preventDefault();
    void leave();
  };
  const body = s.step === 0
    ? <Welcome where={s.where} onChangeWhere={() => setWhere(true)} name={s.name} onName={(name) => { set({ name }); setNameError(null); }} nameError={nameError} />
    : s.step === 1
      ? <Models engine={engine} off={s.off} onOff={(off) => set({ off })} hello={s.hello} onHello={(hello) => set({ hello })} onExamples={(examples) => set({ examples })} />
      : s.step === 2
        ? <ModeStep mode={s.mode} onMode={(mode) => { set({ mode }); setModeError(null); }} error={modeError} />
        : <FirstTrunk s={s} listed={four.listed} defaultName={four.def?.name ?? ""} error={trunkError} onText={(text) => set({ text })} onPick={(id) => { setS((cur) => ({ ...cur, ...togglePick(cur, id) })); setTrunkError(null); }} />;
  // Meet them creates Trunks from templates; Start with <default> only records setup and sends the first message.
  const need = s.step === LAST_STEP ? [...(picked(s).length ? ["trunks.template.create"] : []), "config.get", "config.patch", "chat.send"] : "config.patch";
  const primaryButton = (
    <button type="button" ref={go} className="r1-ob-btn r1-ob-pri r1-ob-go" aria-disabled={!p.ok || saving ? true : undefined} title={p.why} onClick={() => void next()} {...(s.step < 2 ? { "data-local": true } : {})}>
      {saving ? "Saving…" : p.label}
    </button>
  );
  return (
    <div className="r1-ob" onKeyDown={onKey} data-sheet={where || undefined}>
      <div className="r1-ob-card" role="dialog" aria-modal="true" aria-label="Set up Branch">
        <div className="r1-ob-dots" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={s.step + 1} aria-label={`Step ${s.step + 1} of ${STEPS.length}`}>
          {STEPS.map((step, j) => <i key={step.id} className={j === s.step ? "on" : j < s.step ? "done" : undefined} title={step.name} />)}
        </div>
        <div className="r1-ob-body" key={s.step}>{body}</div>
        <div className="r1-ob-foot">
          {s.step ? <button type="button" className="r1-ob-btn r1-ob-quiet" data-local onClick={() => set({ step: s.step - 1 })}>Back</button> : <span />}
          {s.step >= 2 ? <Coming need={need} where={p.label}>{primaryButton}</Coming> : primaryButton}
        </div>
        {talkError ? <p className="r1-ob-error" role="alert">{talkError}</p> : null}
        <div className="r1-ob-later">
          {s.step === 0 ? <><Coming need={WAITS_FOR.talk} unwired={!onTalk} reason={onTalk ? "This engine can’t start a conversation." : "Setting up by talking comes in a later update."} where="Set up by talking"><button type="button" className="r1-ob-link" disabled={talking} onClick={() => void talk()}>{talking ? "Starting…" : "Set up by talking"}</button></Coming><span aria-hidden="true">·</span></> : null}
          <button type="button" className="r1-ob-link" data-local onClick={() => void leave()}>Set up later</button>
        </div>
      </div>
      {where ? <WhereSheet where={s.where} onPick={(w) => { set({ where: w }); setWhere(false); }} onClose={() => setWhere(false)} /> : null}
    </div>
  );
}
