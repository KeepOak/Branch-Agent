// Interactive free local model setup: ask with size and Cancel, and never download until Yes.
import { useEffect, useRef, useState } from "react";
import { Coming } from "../glass/coming";
import { useWizard, type WizardStep } from "../places/settings/use-wizard";
import type { WindowEngine } from "./engine";
import { FREE_MODEL_FAILED, NO_KEY_DEFAULT_KIND } from "./no-key-default";

export const FREE_MODEL_CANCELLED = "Setup cancelled. Chat stays open; connect a model when you want.";
export const FREE_MODEL_CHECKING = "Checking for a free local model…";
export const FREE_MODEL_RETRY = "Try a free local model";
const WIZARD_NEED = ["branch.setup.activate.start", "wizard.next", "wizard.cancel"] as const;

export type FreeModelSetupVariant = "composer" | "onboarding";

type Props = {
  engine: WindowEngine;
  onReady?: () => void;
  variant?: FreeModelSetupVariant;
};

function friendlyWizardError(message: string): string {
  if (/sign-in was cancelled/i.test(message)) return FREE_MODEL_CANCELLED;
  return FREE_MODEL_FAILED;
}

const PLAIN_QUESTION = "Download a free model so Branch can answer without an account?";

export function plainFreeModelQuestion(step: Pick<WizardStep, "message">): string {
  // Only extract the model fields from the engine's final question, never its recommendation.
  const question = (step.message ?? "").trim().split(/\r?\n\s*\r?\n/).at(-1) ?? "";
  const download = /^Download (.+?) \((\d+(?:\.\d+)?) GB\), .+runtime, then use this model\?$/.exec(question);
  const cached = /(?:^|\. )Use cached (.+?)(?:, download any missing .+runtime files, then use this model\?| on Gateway host .+ with the verified CPU runtime\?)$/.exec(question);
  const name = (download?.[1] ?? cached?.[1])?.trim();
  if (!name || /runtime|\bCUDA\b|\bCPU\b|embedding|tool calls?|llama\.cpp|\b(?:metal|vulkan|backend|gateway|host)\b|[\r\n]/i.test(name)) return PLAIN_QUESTION;
  return download
    ? `Download a free model (${name}, ${download[2]} GB) so Branch can answer without an account?`
    : `Use the free model ${name} that is already on this computer so Branch can answer without an account?`;
}

function plainFreeModelStep(step: WizardStep): string {
  if (step.type === "confirm") return plainFreeModelQuestion(step);
  if (step.title === "Setup skipped") return "Free model setup was skipped.";
  // Keep numeric download progress, but not file, computer, or backend names.
  const progress = /(\d+(?:\.\d+)?% \([\d.]+\/[\d.]+ GB, [\d.]+ MB\/s\))$/.exec(step.message ?? "");
  return progress ? `Downloading… ${progress[1]}` : "Preparing your free model…";
}

export function FreeModelSetup({ engine, onReady, variant = "composer" }: Props) {
  const [run, setRun] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const retry = () => {
    setCancelled(false);
    setRun((n) => n + 1);
  };
  const card = variant === "onboarding" ? "r1-ob-hello" : "r1c-free";
  if (cancelled) {
    return (
      <div className={card} data-testid="free-model-setup">
        <p>{FREE_MODEL_CANCELLED}</p>
        <div className={variant === "onboarding" ? "r1-ob-acts" : "r1c-free-acts"}>
          <Coming need={WIZARD_NEED} where={FREE_MODEL_RETRY} engine={engine}>
            <button type="button" className={variant === "onboarding" ? "r1-ob-btn" : "r1c-undo"} onClick={retry}>{FREE_MODEL_RETRY}</button>
          </Coming>
        </div>
      </div>
    );
  }
  return <FreeModelWizard key={run} engine={engine} onReady={onReady} onCancel={() => setCancelled(true)} onRetry={retry} variant={variant} />;
}

function FreeModelWizard({
  engine,
  onReady,
  onCancel,
  onRetry,
  variant,
}: {
  engine: WindowEngine;
  onReady?: () => void;
  onCancel: () => void;
  onRetry: () => void;
  variant: FreeModelSetupVariant;
}) {
  const w = useWizard(engine, {
    method: "branch.setup.activate.start",
    params: { kind: NO_KEY_DEFAULT_KIND, ...(engine.agentId ? { agentId: engine.agentId } : {}) },
  });
  const announced = useRef(false);
  const cancelRef = useRef(w.cancel);
  useEffect(() => { cancelRef.current = w.cancel; });
  useEffect(() => {
    if (w.view.phase === "done" && !announced.current) {
      announced.current = true;
      onReady?.();
    }
  }, [w.view.phase, onReady]);
  useEffect(() => () => { cancelRef.current(); }, []);
  const cancel = () => {
    w.cancel();
    onCancel();
  };
  const card = variant === "onboarding" ? "r1-ob-hello" : "r1c-free";
  const acts = variant === "onboarding" ? "r1-ob-acts" : "r1c-free-acts";
  const btn = variant === "onboarding" ? "r1-ob-btn" : "r1c-undo";
  const pri = variant === "onboarding" ? "r1-ob-btn r1-ob-pri" : "r1c-undo";
  const step = w.view.phase === "step" ? w.view.step : null;
  const asking = w.view.phase === "step" && !w.view.waiting && w.view.step.type === "confirm";
  return (
    <div className={card} data-testid="free-model-setup" aria-live="polite">
      {w.view.phase === "starting" ? <p role="status">{FREE_MODEL_CHECKING}</p> : null}
      {step ? <p data-lines="">{plainFreeModelStep(step)}</p> : null}
      {w.view.phase === "error" ? <p role="alert" data-testid="no-key-failed">{friendlyWizardError(w.view.message)}</p> : null}
      <div className={acts}>
        {asking ? (
          <Coming need={WIZARD_NEED} where="Download free local model" engine={engine}>
            <button type="button" className={pri} disabled={w.busy} onClick={() => w.answer(true)}>Yes</button>
          </Coming>
        ) : null}
        {w.view.phase === "error" ? (
          <Coming need={WIZARD_NEED} where="Try again" engine={engine}>
            <button type="button" className={btn} onClick={onRetry}>Try again</button>
          </Coming>
        ) : null}
        {w.view.phase !== "done" ? (
          <Coming need="wizard.cancel" where="Cancel free local model" engine={engine}>
            <button type="button" className={btn} onClick={cancel}>Cancel</button>
          </Coming>
        ) : null}
      </div>
    </div>
  );
}
