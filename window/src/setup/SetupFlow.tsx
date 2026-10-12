// The 11-step setup once the window is connected (DESIGN-SPEC §4.8.1). Steps 1–2 may already have been answered on
// the pre-connect screens; then it opens at Models.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { PairDialog } from "../places/customize/pairing";
import { AccountLoginDialog } from "../places/settings/AccountLogin";
import { ConnectDialog } from "../places/settings/set1/chatapps-connect";
import { AddAccountDialog } from "../places/settings/set1/add-account";
import { providersOf } from "../places/settings/set1/accounts";
import { list, type RecordValue } from "../places/settings/adapter";
import { useResource } from "../places/settings/hooks";
import type { LoginStart } from "../places/settings/account-login";
import { Icon } from "../shell/icons";
import { notify } from "../shell/notify";
import { readThemeChoice, setThemeChoice } from "../theme/theme";
import { doneSteps, firstOn, freshChoices, LAST, railTicked, RUN_SETUP_AGAIN, STEPS, type Check, type SetupChoices, type TestResult } from "./setup-model";
import { SetupShell } from "./SetupShell";
import { WelcomeHero } from "./SetupBrand";
import { ModelsBody, WelcomeBody, WhereBody } from "./steps-early";
import { MoreBody } from "./more-step";
import { type ChatApp, CheckBody, KeepBody, PeopleBody, ReachBody, reachLede, ToolsBody, TrunksBody, YoursBody } from "./steps-later";
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
  0: ["Hi, I’m Branch.", "An assistant that lives on this computer, with Trunks that each take one job. This takes about three minutes; you can change everything later."],
  1: ["Where should Branch run?", "The engine and the gateway live here. You can talk to it from anywhere."],
  2: ["Which models should answer?", "Found on this computer:"],
  3: ["Make it yours", "Two quick choices. Both can change any time in Settings."],
  4: ["Your first Trunks", "Pick a few, or tell Branch about your life and work and it proposes them."],
  5: ["Reach Branch anywhere", "Message your Trunks from apps you already use."],
  6: ["Tools to start with", "Picked for your Trunks. The rest is under the plug."],
  7: ["Keep it running"],
  8: ["Anyone else?", "People on this computer, teammates on theirs, or your keepoak.com team. Skip it if it’s just you."],
  9: ["Two more things", "All optional. Skip them and Branch works the same."],
  10: ["All set?", "Branch checks everything before you start."],
};
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
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [needsContact] = useState(() => p.requireContact || !p.trunkNames.length);
  return <SetupFlowBody {...p} needsContact={needsContact && !contact} onFirstTrunkCreated={(id, name) => { setContact({ id, name }); p.onContactCreated?.(); }} defaultAgentId={contact?.id ?? p.defaultAgentId} defaultName={contact?.name ?? p.defaultName} trunkNames={contact ? [...p.trunkNames, contact.name] : p.trunkNames} />;
}

function SetupFlowBody(p: Props & { needsContact: boolean; onFirstTrunkCreated: (id: string, name: string) => void }) {
  const [choices, setChoices] = useChoices();
  const [step, setStep] = useState(p.startAt ?? 0);
  const [test, setTest] = useState<TestResult | "testing" | null>(null);
  // null until the person changes it: setup writes the same Install updates state as Settings.
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [talking, setTalking] = useState(false);
  // Start with Windows: on for a fresh Branch (as the design has it), applied through the Branch app when setup finishes.
  const [boot, setBoot] = useState<boolean | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [login, setLogin] = useState<LoginStart | null>(null);
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
  const latest = useRef({ choices, autoUpdate, boot });
  latest.current = { choices, autoUpdate, boot };
  const close = async (finished: boolean, contactReady = false) => {
    if (p.needsContact && !contactReady) { setStep(4); return; }
    setBusy(true);
    const { choices, autoUpdate, boot } = latest.current;
    try {
      const preferred = models.detected ? firstOn(models.detected, choices.modelsOff) : null;
      if (finished && preferred && !known?.model && !(test && test !== "testing" && test.ok && test.modelRef === preferred.modelRef)) {
        const selected = await testModel(p.engine, models.detected!, choices.modelsOff, known?.model ?? null);
        setTest(selected);
      }
      await recordSetup(p.engine, choices, p.version, finished ? autoUpdate : null);
      const desk = desktopControls();
      if (finished && "bridge" in desk && (boot !== null || !known?.promise)) await desk.bridge.set("startWithWindows", boot ?? true);
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
  const answer = (q: TalkQuestion, o: TalkOption) => {
    if (STEPS[q.step] === "Make it yours") { const look = o.value as SetupChoices["look"]; set({ look }); setThemeChoice(look); }
    else if (STEPS[q.step] === "Your first Trunks" && o.value !== "enough") setChoices((c) => ({ ...c, jobs: [...c.jobs, Number(o.value)] }));
    else if (STEPS[q.step] === "Reach it anywhere" && o.value === "phone") setPairing(true);
    else if (STEPS[q.step] === "Reach it anywhere" && o.value.startsWith("app:")) { const app = apps?.find((a) => a.id === o.value.slice(4)); if (app) setConnecting(app); }
    else if (STEPS[q.step] === "Keep it running") setAutoUpdate(o.value === "yes");
    else if (STEPS[q.step] === "People") set({ people: o.value === "none" ? null : Number(o.value) });
  };
  useEffect(() => {
    if (!talking) return;
    p.onTalk?.({
      start: firstUndone(done, Math.max(3, step)),
      state: { look: choices.look, jobs: choices.jobs, apps: (apps ?? []).map((a) => ({ id: a.id, label: a.label, connected: Boolean(a.connected) })), autoUpdate: autoUpdate ?? known?.autoUpdate ?? false },
      done: (i) => done.has(i),
      answer,
      steps: (i) => { setTalking(false); setStep(i); p.onTalk?.(null); },
      finish: () => { setTalking(false); p.onTalk?.(null); void close(true); },
    });
    // Published once when talking starts; the card keeps its own place from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talking]);
  const doneChecks = checks.filter((c) => c.state !== "checking").length;
  const modelNeedsConnection = checks.some((c) => c.name === "The model" && c.state === "bad")
    && !known?.model
    && !(models.detected && firstOn(models.detected, choices.modelsOff));
  const body = renderStep(step, { p, choices, set, models, inUse: known?.model ?? null, test, setTest, setLogin, apps, setConnecting, setPairing, autoUpdate: autoUpdate ?? known?.autoUpdate ?? false, setAutoUpdate, boot: boot ?? (known?.promise ? null : true), setBoot, checks, setStep });
  const [title, lede] = STEPS[step] === "Reach it anywhere" ? [TITLES[step][0], reachLede(apps)] : TITLES[step];
  const footer = (
    <>
      {step > 0 ? (
        <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
          Back
        </button>
      ) : null}
      <span className="grow" />
      {step >= 3 && step < LAST ? (
        <button type="button" className="btn ghost" data-testid="setup-talk" onClick={() => setTalking(true)}>
          Finish by talking
        </button>
      ) : null}
      {step === LAST ? (
        <button type="button" className="btn pri" data-testid="setup-finish" disabled={busy || doneChecks < checks.length} onClick={() => modelNeedsConnection ? (setStep(2), setLogin({ agentId: p.defaultAgentId ?? p.engine.agentId ?? "", provider: "", choiceId: "", method: SECRET })) : void close(true)}>
          {modelNeedsConnection ? "Connect a model" : doneChecks < checks.length ? `Checking… ${doneChecks} of ${checks.length}` : "Open Branch and take the walkthrough"}
        </button>
      ) : (
        <button type="button" className="btn pri" data-testid="setup-next" disabled={step === 0 && !choices.promise} onClick={() => setStep(step + 1)}>
          {step === 0 ? "Start" : "Continue"}
        </button>
      )}
    </>
  );
  if (p.needsContact && step === 4) {
    return <FirstTrunk engine={p.engine} onCreated={p.onFirstTrunkCreated} onBack={setStep} onSkip={() => void close(false, true)} />;
  }
  const dialogs = (
    <>
      {login && login.method !== SECRET ? <AccountLoginDialog engine={p.engine} start={login} onClose={(signedIn) => { setLogin(null); if (signedIn) models.reload(); }} /> : null}
      {login && login.method === SECRET ? <SetupAddAccountDialog engine={p.engine} agentId={login.agentId} onClose={(added) => { setLogin(null); if (added) models.reload(); }} /> : null}
      {connecting ? <ConnectDialog engine={p.engine} app={{ id: connecting.id, name: connecting.label, detail: "" }} onClose={(changed) => { setConnecting(null); if (changed) chat.reload(); }} /> : null}
      {pairing ? <PairDialog engine={p.engine} close={() => setPairing(false)} /> : null}
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
  apps: ChatApp[] | null;
  setConnecting: (app: ChatApp) => void;
  setPairing: (on: boolean) => void;
  autoUpdate: boolean;
  setAutoUpdate: (v: boolean) => void;
  /** Start with Windows as chosen in setup; null shows what the Branch app has now. */
  boot: boolean | null;
  setBoot: (v: boolean) => void;
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
          engine={c.p.engine}
          defaultAgentId={c.p.defaultAgentId}
          defaultName={c.p.defaultName}
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
      return <KeepBody autoUpdate={c.autoUpdate} onAutoUpdate={c.setAutoUpdate} boot={c.boot} onBoot={c.setBoot} />;
    case "People":
      return <PeopleBody people={choices.people} onPeople={(people) => set({ people })} />;
    case "Two more things":
      return <MoreBody engine={c.p.engine} agentId={c.p.defaultAgentId} trunkName={c.p.defaultName} />;
    default:
      return <CheckBody checks={c.checks} onFix={(i) => { c.setStep(i); if (i === 2) c.setLogin({ agentId: c.p.defaultAgentId ?? c.p.engine.agentId ?? "", provider: "", choiceId: "", method: SECRET }); }} />;
  }
}
