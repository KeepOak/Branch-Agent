// Setup once the window is connected (DESIGN-SPEC §4.8.1): five steps. Welcome and Where may already have been answered
// on the pre-connect screens; then it opens at Models. Look, chat apps, tools, updates, people and memory are not asked
// here; Settings has them with the defaults setup would have picked.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { AccountLoginDialog } from "../places/settings/AccountLogin";
import { AddAccountDialog } from "../places/settings/set1/add-account";
import { providersOf } from "../places/settings/set1/accounts";
import { list, type RecordValue } from "../places/settings/adapter";
import { useResource } from "../places/settings/hooks";
import type { LoginStart } from "../places/settings/account-login";
import { Icon } from "../shell/icons";
import { notify } from "../shell/notify";
import { readThemeChoice } from "../theme/theme";
import { doneSteps, firstOn, freshChoices, LAST, railTicked, RUN_SETUP_AGAIN, STEPS, TRUNKS_STEP, type Check, type SetupChoices, type TestResult } from "./setup-model";
import { SetupShell } from "./SetupShell";
import { WelcomeHero } from "./SetupBrand";
import { ModelsBody, WelcomeBody, WhereBody } from "./steps-early";
import { CheckBody, TrunksBody } from "./steps-later";
import { makeTrunks, recordSetup, runChecks, testModel, useChatApps, useDetected, useKnown } from "./use-setup-engine";
import { readPreConnect } from "./pre-connect-state";
import { FirstTrunk } from "./FirstTrunk";
import type { TalkHandle } from "./TalkSetup";
import type { TalkOption, TalkQuestion } from "./talk-setup";
import { desktopControls } from "../connect/desktop-controls";

type Props = {
  engine: WindowEngine;
  version: string;
  trunkNames: string[];
  defaultAgentId: string | null;
  /** The default Trunk's name, for the first routine's line. */
  defaultName: string;
  startAt?: number;
  requireContact?: boolean;
  onContactCreated?: () => void;
  onClose: (finished: boolean) => void;
  onLocalModel: () => void;
  /** Finish by talking: the setup card to show above the default Trunk's message box, or null to take it away. */
  onTalk?: (handle: TalkHandle | null) => void;
};

const TITLES: Record<number, [string, string?]> = {
  0: ["Hi, I’m Branch.", "An assistant that lives on this computer, with Trunks that each take one job. You can change everything later in Settings."],
  1: ["Where should Branch run?", "The engine and the gateway live here. You can talk to it from anywhere."],
  2: ["Which models should answer?", "Found on this computer:"],
  3: ["Your first Trunks", "A Trunk is a contact with one ongoing conversation. New chats go to your default Trunk."],
  4: ["Ready", "Branch checks everything before you start."],
};

const MODELS_STEP = STEPS.indexOf("Models");
/** Start goes past the steps an already set-up Branch has done, to the first one left. */
function firstUndone(done: Set<number>, from: number): number {
  for (let i = from; i < LAST; i++) {
    if (!done.has(i)) {
      return i;
    }
  }
  return LAST;
}

function useChoices() {
  const pre = readPreConnect();
  return useState<SetupChoices>(() => ({ ...freshChoices(readThemeChoice()), ...(pre ? { promise: pre.promise, where: pre.where } : {}) }));
}

export function SetupFlow(p: Props) {
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [needsContact] = useState(() => p.requireContact || !p.trunkNames.length);
  return <SetupFlowBody {...p} needsContact={needsContact && !contact} onFirstTrunkCreated={(id, name) => { setContact({ id, name }); p.onContactCreated?.(); }} defaultAgentId={contact?.id ?? p.defaultAgentId} defaultName={contact?.name ?? p.defaultName} trunkNames={contact ? [...p.trunkNames, contact.name] : p.trunkNames} />;
}

function SetupFlowBody(p: Props & { needsContact: boolean; onFirstTrunkCreated: (id: string, name: string) => void }) {
  const [choices, setChoices] = useChoices();
  const [step, setStep] = useState(p.startAt ?? 0);
  const [test, setTest] = useState<TestResult | "testing" | null>(null);
  const [talking, setTalking] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [login, setLogin] = useState<LoginStart | null>(null);
  const [busy, setBusy] = useState(false);
  const models = useDetected(p.engine);
  const chat = useChatApps(p.engine);
  const apps = chat.apps;
  const known = useKnown(p.engine, models.detected, p.trunkNames);
  // Whether this is a fresh Branch is read once, before anything on this screen can change it (a sign-in on Models
  // changes the detected model, and must not turn a fresh install into an existing one at finish).
  const startKnown = useKnown(p.engine, null, p.trunkNames);
  const freshInstall = useRef<boolean | null>(null);
  useEffect(() => {
    if (startKnown && freshInstall.current === null) freshInstall.current = !startKnown.where && !startKnown.model;
  }, [startKnown]);
  const done = known ? doneSteps(known) : new Set<number>();
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    const on = () => setStep(0);
    window.addEventListener(RUN_SETUP_AGAIN, on);
    return () => window.removeEventListener(RUN_SETUP_AGAIN, on);
  }, []);
  useEffect(() => {
    // An already set-up Branch: prefill from its config and open at the first step not done yet, once.
    if (!known || prefilled) {
      return;
    }
    setPrefilled(true);
    // An already set-up Branch starts with only the Trunks it has; a fresh one keeps the spec's two picks.
    setChoices((c) => ({ ...c, promise: c.promise || known.promise, jobs: known.model || known.jobs.length ? known.jobs : c.jobs }));
    if (p.startAt === undefined && known.where && step === 0) {
      setStep(firstUndone(doneSteps(known), 0));
    }
  }, [known, prefilled, setChoices, step, p.startAt]);
  const set = (patch: Partial<SetupChoices>) => setChoices((c) => ({ ...c, ...patch }));
  useEffect(() => {
    if (step !== LAST) {
      return;
    }
    // Leaving the step and coming back starts the checks again (§4.8.1.11).
    setChecks(runChecks(p.engine, apps ?? [], (i, row) => setChecks((rows) => rows.map((r, j) => (j === i ? row : r)))));
  }, [step, p.engine, apps]);
  const latest = useRef({ choices });
  latest.current = { choices };
  const close = async (finished: boolean, contactReady = false) => {
    if (p.needsContact && !contactReady) { setStep(TRUNKS_STEP); return; }
    setBusy(true);
    const { choices } = latest.current;
    try {
      const preferred = models.detected ? firstOn(models.detected, choices.modelsOff) : null;
      if (finished && preferred && !known?.model && !(test && test !== "testing" && test.ok && test.modelRef === preferred.modelRef)) {
        const selected = await testModel(p.engine, models.detected!, choices.modelsOff, known?.model ?? null);
        setTest(selected);
      }
      // A fresh Branch keeps itself up to date and starts with the computer; an existing one keeps what it has.
      const fresh = finished && freshInstall.current === true;
      await recordSetup(p.engine, choices, p.version, fresh ? true : null);
      const desk = desktopControls();
      if (fresh && "bridge" in desk) await desk.bridge.set("startWithWindows", true);
      if (finished) {
        const failed = await makeTrunks(p.engine, choices.jobs, p.trunkNames);
        notify("Branch is ready. Here’s the two-minute walkthrough.", failed.length ? { line: failed.join(" ") } : {});
      }
      p.onClose(finished);
    } catch (e) {
      notify("Couldn’t save setup. Try again.", { tone: "bad" });
      setBusy(false);
    }
  };
  // The one way out of setup: Finish and "Open Branch" on the talk card both come here, so no path skips the model gate.
  const doneChecks = checks.filter((c) => c.state !== "checking").length;
  // The model row is named for the model once it answers, so it is found by the step its fix opens.
  const modelChecked = checks.some((c) => c.state === "ok" && c.fix === MODELS_STEP);
  const hasModel = modelChecked || Boolean(known?.model) || Boolean(models.detected && firstOn(models.detected, choices.modelsOff));
  const modelNeedsConnection = checks.some((c) => c.name === "The model" && c.state === "bad") && !hasModel;
  const finishSetup = () => {
    if (!hasModel) {
      setStep(MODELS_STEP);
      setLogin({ agentId: p.defaultAgentId ?? p.engine.agentId ?? "", provider: "", choiceId: "", method: SECRET });
      return;
    }
    if (doneChecks < checks.length) {
      setStep(LAST);
      return;
    }
    void close(true);
  };
  const finishRef = useRef(finishSetup);
  finishRef.current = finishSetup;
  const answer = (q: TalkQuestion, o: TalkOption) => {
    if (STEPS[q.step] === "Your first Trunks" && o.value !== "enough") setChoices((c) => ({ ...c, jobs: [...c.jobs, Number(o.value)] }));
  };
  useEffect(() => {
    if (!talking) return;
    p.onTalk?.({
      start: firstUndone(done, Math.max(TRUNKS_STEP, step)),
      state: { jobs: choices.jobs },
      done: (i) => done.has(i),
      answer,
      steps: (i) => { setTalking(false); setStep(i); p.onTalk?.(null); },
      finish: () => { setTalking(false); p.onTalk?.(null); finishRef.current(); },
    });
    // Published once when talking starts; the card keeps its own place from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talking]);
  const body = renderStep(step, { p, choices, set, models, inUse: known?.model ?? null, test, setTest, setLogin, checks, setStep });
  const [title, lede] = TITLES[step];
  const footer = (
    <>
      {step > 0 ? (
        <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
          Back
        </button>
      ) : null}
      <span className="grow" />
      {step >= STEPS.indexOf("Models") && step < LAST ? (
        <button type="button" className="btn ghost" data-testid="setup-talk" onClick={() => setTalking(true)}>
          Finish by talking
        </button>
      ) : null}
      {step === LAST ? (
        <button type="button" className="btn pri" data-testid="setup-finish" disabled={busy || doneChecks < checks.length} onClick={finishSetup}>
          {modelNeedsConnection ? "Connect a model" : doneChecks < checks.length ? `Checking… ${doneChecks} of ${checks.length}` : "Open Branch and take the walkthrough"}
        </button>
      ) : (
        <button type="button" className="btn pri" data-testid="setup-next" disabled={step === 0 && !choices.promise} onClick={() => setStep(step + 1)}>
          {step === 0 ? "Start" : "Continue"}
        </button>
      )}
    </>
  );
  if (p.needsContact && step === TRUNKS_STEP) {
    return <FirstTrunk engine={p.engine} onCreated={p.onFirstTrunkCreated} onBack={setStep} onSkip={() => void close(false, true)} />;
  }
  const dialogs = (
    <>
      {login && login.method !== SECRET ? <AccountLoginDialog engine={p.engine} start={login} onClose={(signedIn) => { setLogin(null); if (signedIn) models.reload(); }} /> : null}
      {login && login.method === SECRET ? <SetupAddAccountDialog engine={p.engine} agentId={login.agentId} onClose={(added) => { setLogin(null); if (added) models.reload(); }} /> : null}
    </>
  );
  if (talking) return dialogs;
  return (
    <>
      <SetupShell
        step={step}
        reach={choices.promise ? LAST : 0}
        reachReason="Tick the promise on Welcome first."
        done={(i) => railTicked(step, i)}
        onStep={setStep}
        onSkip={step === 0 || busy ? null : () => void close(false)}
        title={title}
        lede={lede}
        hero={step === 0 ? <WelcomeHero /> : undefined}
        footer={footer}
      >
        {body}
      </SetupShell>
      {dialogs}
    </>
  );
}

type Ctx = {
  p: Props;
  choices: SetupChoices;
  set: (patch: Partial<SetupChoices>) => void;
  models: ReturnType<typeof useDetected>;
  inUse: string | null;
  test: TestResult | "testing" | null;
  setTest: (t: TestResult | "testing" | null) => void;
  setLogin: (l: LoginStart) => void;
  checks: Check[];
  setStep: (i: number) => void;
};

const SECRET = "secret";

function SetupAddAccountDialog({ engine, agentId, onClose }: { engine: WindowEngine; agentId: string; onClose: (added: boolean) => void }) {
  const status = useResource<RecordValue>(engine, "models.authStatus", { agentId });
  return <AddAccountDialog engine={engine} start={{}} caps={list(status.data?.providerCapabilities)} providers={providersOf(status.data?.providers)} agent={{ agentId }} onClose={onClose} />;
}

function AddAccount({ c }: { c: Ctx }) {
  return (
    <span className="ob-add">
      <button type="button" className="btn sm" disabled={!c.p.defaultAgentId && !c.p.engine.agentId} onClick={() => c.setLogin({ agentId: c.p.defaultAgentId ?? c.p.engine.agentId ?? "", provider: "", choiceId: "", method: SECRET })}>
        <Icon name="plus" size={13} />
        Add an account
      </button>
    </span>
  );
}

function renderStep(step: number, c: Ctx): ReactNode {
  const { choices, set } = c;
  switch (STEPS[step]) {
    case "Welcome":
      return <WelcomeBody promise={choices.promise} onPromise={(promise) => set({ promise })} />;
    case "Where Branch runs":
      return <WhereBody where={choices.where} onWhere={(where) => set({ where })} remote={<p className="hint">This window already talks to a Branch. To move to another computer, use the machine menu › Connect to a Branch elsewhere.</p>} />;
    case "Models":
      return (
        <ModelsBody
          detected={c.models.detected}
          error={c.models.error}
          off={choices.modelsOff}
          onToggle={(key) => set({ modelsOff: choices.modelsOff.includes(key) ? choices.modelsOff.filter((k) => k !== key) : [...choices.modelsOff, key] })}
          inUse={c.inUse}
          test={c.test}
          canTest={Boolean(c.models.detected?.candidates.length)}
          onTest={() => {
            const detected = c.models.detected;
            if (detected) {
              c.setTest("testing");
              void testModel(c.p.engine, detected, choices.modelsOff, c.inUse).then(c.setTest);
            }
          }}
          addAccount={<AddAccount c={c} />}
          onLocal={c.p.onLocalModel}
        />
      );
    case "Your first Trunks":
      return (
        <TrunksBody
          engine={c.p.engine}
          defaultAgentId={c.p.defaultAgentId}
          defaultName={c.p.defaultName}
          jobs={choices.jobs}
          onJob={(i) => set({ jobs: choices.jobs.includes(i) ? choices.jobs.filter((j) => j !== i) : [...choices.jobs, i] })}
        />
      );
    default:
      return <CheckBody checks={c.checks} onFix={(i) => { c.setStep(i); if (i === 2) c.setLogin({ agentId: c.p.defaultAgentId ?? c.p.engine.agentId ?? "", provider: "", choiceId: "", method: SECRET }); }} />;
  }
}
