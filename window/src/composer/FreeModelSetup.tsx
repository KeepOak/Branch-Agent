// Interactive free local model setup: ask with size and Cancel, and never download until Yes.
import { useEffect, useRef, useState } from "react";
import { Coming } from "../glass/coming";
import { useWizard } from "../places/settings/use-wizard";
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
  if (/sign-in did not finish/i.test(message)) return FREE_MODEL_FAILED;
  return message.trim() || FREE_MODEL_FAILED;
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
      {step ? (
        <>
          {step.title ? <b>{step.title}</b> : null}
          {step.message ? <p data-lines="">{step.message}</p> : null}
        </>
      ) : null}
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
