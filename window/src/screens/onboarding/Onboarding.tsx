// The R1 onboarding card (HANDOFF R1-07, preview item 37 `draw()`): a centred floating-glass card at 1440, full
// screen with a sticky footer at 390. Progress dots, the step, Back / primary, and "Set up by talking" (step 1 only) and
// "Set up later". Esc is Set up later. Each step's engine call happens in the step that owns it.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { configStore } from "../../places/settings/config-store";
import { errorText } from "../../places/settings/adapter";
import { Models } from "./Models";
import { ModeStep } from "./ModeStep";
import { clampStep, freshState, MODES, primary, STEPS, type OnboardingState } from "./model";
import { Welcome, WhereSheet } from "./Welcome";
import "./onboarding.css";

export type OnboardingProps = {
  engine: WindowEngine;
  startAt?: number;
  /** Set up later (and Esc): the card closes; what was already saved stays saved. */
  onLater: (state: OnboardingState) => void;
  /** Set up by talking: the same questions in a conversation named "Setting up Branch". */
  onTalk?: () => void;
  /** Called after "How much it may do" saved, with the answers so far. */
  onAnswered: (state: OnboardingState) => void;
};

export function Onboarding({ engine, startAt = 0, onLater, onTalk, onAnswered }: OnboardingProps) {
  const [s, setS] = useState<OnboardingState>(() => freshState(startAt));
  const [where, setWhere] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const go = useRef<HTMLButtonElement>(null);
  const set = (patch: Partial<OnboardingState>) => setS((cur) => ({ ...cur, ...patch }));
  useEffect(() => { go.current?.focus({ preventScroll: true }); }, [s.step]);
  const p = primary(s);
  const next = async () => {
    if (!p.ok || saving) return;
    if (s.step < 2) { set({ step: clampStep(s.step + 1) }); return; }
    const exec = MODES.find((m) => m.id === s.mode)?.exec;
    if (!exec) return;
    setSaving(true); setModeError(null);
    try {
      // The engine refuses mode beside the older security/ask keys, so those go (as Settings › Permissions saves it).
      await configStore(engine).set("tools.exec", { mode: exec, security: null, ask: null });
      onAnswered(s);
    } catch (e) {
      setModeError(`Couldn’t save that. ${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || where) return;
    e.preventDefault();
    onLater(s);
  };
  const body = s.step === 0
    ? <Welcome where={s.where} onChangeWhere={() => setWhere(true)} />
    : s.step === 1
      ? <Models engine={engine} off={s.off} onOff={(off) => set({ off })} hello={s.hello} onHello={(hello) => set({ hello })} />
      : <ModeStep mode={s.mode} onMode={(mode) => { set({ mode }); setModeError(null); }} error={modeError} />;
  const primaryButton = (
    <button type="button" ref={go} className="r1-ob-btn r1-ob-pri r1-ob-go" aria-disabled={!p.ok || saving ? true : undefined} title={p.why} onClick={() => void next()} {...(s.step < 2 ? { "data-local": true } : {})}>
      {saving ? "Saving…" : p.label}
    </button>
  );
  return (
    <div className="r1-ob" onKeyDown={onKey}>
      <div className="r1-ob-card" role="dialog" aria-modal="true" aria-label="Set up Branch">
        <div className="r1-ob-dots" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={s.step + 1} aria-label={`Step ${s.step + 1} of ${STEPS.length}`}>
          {STEPS.map((step, j) => <i key={step.id} className={j === s.step ? "on" : j < s.step ? "done" : undefined} title={step.name} />)}
        </div>
        <div className="r1-ob-body" key={s.step}>{body}</div>
        <div className="r1-ob-foot">
          {s.step ? <button type="button" className="r1-ob-btn r1-ob-quiet" data-local onClick={() => set({ step: s.step - 1 })}>Back</button> : <span />}
          {s.step === 2 ? <Coming need="config.patch" where="Continue">{primaryButton}</Coming> : primaryButton}
        </div>
        <div className="r1-ob-later">
          {s.step === 0 ? <>{onTalk ? <button type="button" className="r1-ob-link" data-local onClick={onTalk}>Set up by talking</button> : <button type="button" className="r1-ob-link" aria-disabled="true" data-coming="Setting up by talking comes in a later update." title="Setting up by talking comes in a later update.">Set up by talking</button>}<span aria-hidden="true">·</span></> : null}
          <button type="button" className="r1-ob-link" data-local onClick={() => onLater(s)}>Set up later</button>
        </div>
      </div>
      {where ? <WhereSheet where={s.where} onPick={(w) => { set({ where: w }); setWhere(false); }} onClose={() => setWhere(false)} /> : null}
    </div>
  );
}
