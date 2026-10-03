// The 11-step setup once the window is connected (DESIGN-SPEC §4.8.1). Steps 1–2 may already have been answered on
// the pre-connect screens; then it opens at Models.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { PairDialog } from "../places/customize/pairing";
import { AccountLoginDialog } from "../places/settings/AccountLogin";
import { ConnectDialog } from "../places/settings/set1/chatapps-connect";
import type { LoginStart } from "../places/settings/account-login";
import { Icon } from "../shell/icons";
import { notify } from "../shell/notify";
import { readThemeChoice, setThemeChoice } from "../theme/theme";
import { doneSteps, freshChoices, LAST, STEPS, type Check, type SetupChoices, type TestResult } from "./setup-model";
import { SetupShell } from "./SetupShell";
import { WelcomeHero } from "./SetupBrand";
import { ModelsBody, WelcomeBody, WhereBody } from "./steps-early";
import { MoreBody } from "./more-step";
import { type ChatApp, CheckBody, KeepBody, PeopleBody, ReachBody, reachLede, ToolsBody, TrunksBody, YoursBody } from "./steps-later";
import { makeTrunks, recordSetup, runChecks, testModel, useChatApps, useDetected, useKnown } from "./use-setup-engine";
import { readPreConnect } from "./pre-connect-state";

type Props = {
  engine: WindowEngine;
  version: string;
  trunkNames: string[];
  defaultAgentId: string | null;
  /** The default Trunk's name, for the first routine's line. */
  defaultName: string;
  startAt?: number;
  onClose: (finished: boolean) => void;
  onLocalModel: () => void;
};

const TITLES: Record<number, [string, string?]> = {
  0: ["Hi, I’m Branch.", "An assistant that lives on this computer, with Trunks that each take one job. This takes about three minutes; you can change everything later."],
  1: ["Where should Branch run?", "The engine and the gateway live here. You can talk to it from anywhere."],
  2: ["Which models should answer?", "Found on this computer:"],
  3: ["Make it yours", "Two quick choices. Both can change any time in Settings."],
  4: ["Your first Trunks", "Pick a few, or tell Branch about your life and work and it proposes them."],
  5: ["Reach Branch anywhere", "Message your Trunks from the apps you already use. Here are the ones this Branch knows."],
  6: ["Tools to start with", "Recommended for the Trunks you picked. Everything else is under the plug."],
  7: ["Keep it running"],
  8: ["Anyone else?", "People on this computer, teammates on theirs, or your keepoak.com team. Skip it if it’s just you."],
  9: ["Two more things", "All optional. Skip them and Branch works the same."],
  10: ["All set?", "Branch checks everything before you start."],
};
const TALK_OFF = "Setting up by talking needs Sapling's setup conversation, which the engine doesn't run yet.";
const PROPOSE_OFF = "Proposing Trunks from a sentence needs a setup call the engine doesn't have yet.";

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
  const [choices, setChoices] = useChoices();
  const [step, setStep] = useState(p.startAt ?? 0);
  const [test, setTest] = useState<TestResult | "testing" | null>(null);
  // null until the person changes it: setup writes update.auto.enabled only then (defaults stay the engine's).
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [login, setLogin] = useState<LoginStart | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const models = useDetected(p.engine);
  const chat = useChatApps(p.engine);
  const apps = chat.apps;
  const [connecting, setConnecting] = useState<ChatApp | null>(null);
  const [pairing, setPairing] = useState(false);
  const known = useKnown(p.engine, models.detected, p.trunkNames);
  const done = known ? doneSteps(known, Boolean(apps?.some((a) => a.connected))) : new Set<number>();
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    // An already set-up Branch: prefill from its config and open at the first step not done yet, once.
    if (!known || prefilled) {
      return;
    }
    setPrefilled(true);
    // An already set-up Branch starts with only the Trunks it has; a fresh one keeps the spec's two picks.
    setChoices((c) => ({ ...c, promise: c.promise || known.promise, jobs: known.model || known.jobs.length ? known.jobs : c.jobs }));
    if (known.promise && step === (p.startAt ?? 0)) {
      setStep(firstUndone(doneSteps(known, false), 0));
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
  const close = async (finished: boolean) => {
    setBusy(true);
    try {
      await recordSetup(p.engine, choices, p.version, finished ? autoUpdate : null);
      if (finished) {
        const failed = await makeTrunks(p.engine, choices.jobs, p.trunkNames);
        notify("Branch is ready. Here’s the two-minute walkthrough.", failed.length ? { line: failed.join(" ") } : {});
      }
      p.onClose(finished);
    } catch (e) {
      notify(`Couldn't save setup: ${e instanceof Error ? e.message : String(e)}`, { tone: "bad" });
      setBusy(false);
    }
  };
  const doneChecks = checks.filter((c) => c.state !== "checking").length;
  const body = renderStep(step, { p, choices, set, models, inUse: known?.model ?? null, test, setTest, setLogin, adding, setAdding, apps, setConnecting, setPairing, autoUpdate: autoUpdate ?? known?.autoUpdate ?? false, setAutoUpdate, checks, setStep });
  const [title, lede] = step === 5 ? [TITLES[5][0], reachLede(apps)] : TITLES[step];
  const footer = (
    <>
      {step > 0 ? (
        <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
          Back
        </button>
      ) : null}
      <span className="grow" />
      {step >= 3 && step < LAST ? (
        <button type="button" className="btn ghost" disabled title={TALK_OFF}>
          Finish by talking
        </button>
      ) : null}
      {step === LAST ? (
        <button type="button" className="btn pri" data-testid="setup-finish" disabled={busy || doneChecks < checks.length} onClick={() => void close(true)}>
          {doneChecks < checks.length ? `Checking… ${doneChecks} of ${checks.length}` : "Open Branch and take the walkthrough"}
        </button>
      ) : (
        <button type="button" className="btn pri" data-testid="setup-next" disabled={step === 0 && !choices.promise} onClick={() => setStep(step === 0 ? firstUndone(done, 1) : step + 1)}>
          {step === 0 ? "Start" : "Continue"}
        </button>
      )}
    </>
  );
  return (
    <>
      <SetupShell
        step={step}
        reach={choices.promise ? LAST : 0}
        reachReason="Tick the promise on Welcome first."
        done={(i) => i < step || done.has(i)}
        onStep={setStep}
        onSkip={step === 0 || busy ? null : () => void close(false)}
        title={title}
        lede={lede}
        hero={step === 0 ? <WelcomeHero /> : undefined}
        footer={footer}
      >
        {body}
      </SetupShell>
      {login ? (
        <AccountLoginDialog
          engine={p.engine}
          start={login}
          onClose={(signedIn) => {
            setLogin(null);
            if (signedIn) {
              models.reload();
            }
          }}
        />
      ) : null}
      {connecting ? (
        <ConnectDialog
          engine={p.engine}
          app={{ id: connecting.id, name: connecting.label, detail: "" }}
          onClose={(changed) => {
            setConnecting(null);
            if (changed) {
              chat.reload();
            }
          }}
        />
      ) : null}
      {pairing ? <PairDialog engine={p.engine} close={() => setPairing(false)} /> : null}
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
  adding: boolean;
  setAdding: (v: boolean) => void;
  apps: ChatApp[] | null;
  setConnecting: (app: ChatApp) => void;
  setPairing: (on: boolean) => void;
  autoUpdate: boolean;
  setAutoUpdate: (v: boolean) => void;
  checks: Check[];
  setStep: (i: number) => void;
};

function AddAccount({ c }: { c: Ctx }) {
  const options = c.models.detected?.authOptions ?? [];
  return (
    <span className="ob-add">
      <button type="button" className="btn sm" aria-expanded={c.adding} disabled={!options.length || !c.p.defaultAgentId} title={options.length ? undefined : "The engine offered no account sign-ins."} onClick={() => c.setAdding(!c.adding)}>
        <Icon name="plus" size={13} />
        Add another account
      </button>
      {c.adding ? (
        <span className="ob-add-list" role="menu">
          {options.map((o) => (
            <button key={o.id} type="button" className="mi" role="menuitem" onClick={() => (c.setAdding(false), c.setLogin({ agentId: c.p.defaultAgentId ?? "", provider: o.label, choiceId: o.id }))}>
              <span className="mi-label">{o.label}</span>
              {o.hint ? <span className="mi-hint">{o.hint}</span> : null}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function renderStep(step: number, c: Ctx): ReactNode {
  const { choices, set } = c;
  switch (STEPS[step]) {
    case "Welcome":
      return <WelcomeBody promise={choices.promise} onPromise={(promise) => set({ promise })} />;
    case "Where Branch runs":
      return <WhereBody where={choices.where} onWhere={(where) => set({ where })} remote={<p className="hint">This window already talks to a Branch. To move to another computer, use the machine menu › Connect to a Branch elsewhere….</p>} />;
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
    case "Make it yours":
      return <YoursBody look={choices.look} onLook={(look) => (set({ look }), setThemeChoice(look))} />;
    case "Your first Trunks":
      return (
        <TrunksBody
          jobs={choices.jobs}
          onJob={(i) => set({ jobs: choices.jobs.includes(i) ? choices.jobs.filter((j) => j !== i) : [...choices.jobs, i] })}
          proposeOff={PROPOSE_OFF}
          propose={
            <button type="button" className="btn sm ob-propose" disabled title={PROPOSE_OFF}>
              <Icon name="spark" size={13} />
              Let Branch propose Trunks
            </button>
          }
        />
      );
    case "Reach it anywhere":
      return <ReachBody apps={c.apps} onConnect={c.setConnecting} onPhone={() => c.setPairing(true)} />;
    case "Tools":
      return <ToolsBody />;
    case "Keep it running":
      return <KeepBody autoUpdate={c.autoUpdate} onAutoUpdate={c.setAutoUpdate} />;
    case "People":
      return <PeopleBody people={choices.people} onPeople={(people) => set({ people })} />;
    case "Two more things":
      return <MoreBody engine={c.p.engine} agentId={c.p.defaultAgentId} trunkName={c.p.defaultName} />;
    default:
      return <CheckBody checks={c.checks} onFix={c.setStep} />;
  }
}
