// Set up a model on this computer: one branch.setup.prepare.start wizard session for the engine's setup option. The
// engine looks at this computer, says what it will download and install before it does, and reports its progress.
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { text, visible, type RecordValue } from "../adapter";
import { Footer, WizardBody } from "../AccountLogin";
import { useWizard } from "../use-wizard";

export type SetupOutcome = "installed" | "skipped" | "failed";

type Props = {
  engine: WindowEngine;
  option: RecordValue;
  agent: { agentId?: string };
  onClose: (outcome?: SetupOutcome) => void;
  onRetry?: () => void;
  lede?: string;
  doneText?: string;
  skippedText?: string;
  failedText?: string;
};

const SKIPPED = /nothing was downloaded|still finds memories by matching words|setup skipped/i;
const RAW = /llama\.cpp|verified CPU|runtime|branch doctor|Gateway host/i;

function outcomeOf(phase: string, notes: string[]): SetupOutcome | undefined {
  if (phase === "error") return "failed";
  if (phase !== "done") return undefined;
  return notes.some((n) => SKIPPED.test(n)) ? "skipped" : "installed";
}

function plainFailure(raw: string, fallback?: string): string {
  if (fallback && RAW.test(raw)) return fallback;
  return raw;
}

export function SetupDialog({ engine, option, agent, onClose, onRetry, lede, doneText, skippedText, failedText }: Props) {
  const w = useWizard(engine, { method: "branch.setup.prepare.start", params: { authChoice: text(option.id), ...agent } });
  const name = visible(option.label);
  const outcome = outcomeOf(w.view.phase, w.notes);
  const close = () => { if (w.view.phase !== "done" && w.view.phase !== "error") w.cancel(); onClose(outcome ?? "skipped"); };
  const defaultLede = /ollama/i.test(text(option.id)) ? "Ollama runs models on this computer. Install Ollama if it isn’t already. A tools-capable model is about 9.6 GB; nothing downloads until you agree." : /llama-cpp|managed/i.test(text(option.id)) ? "Branch installs a local model on this computer. It tells you the download size (often a few GB) and asks before it starts." : /lmstudio/i.test(text(option.id)) ? "LM Studio runs models on this computer. Install LM Studio and load a model there first. Model files can be several GB." : `Branch sets up ${name} on this computer. It says what it will download and install, and how big it is, before it does anything.`;
  const installed = doneText ?? `${name} is set up on this computer. Free and private.`;
  const shownDone = outcome === "skipped" ? (skippedText ?? w.notes.at(-1) ?? installed) : installed;
  const shownError = w.view.phase === "error" ? plainFailure(w.view.message, failedText) : undefined;
  const retryable = Boolean(onRetry) && (outcome === "failed" || outcome === "skipped");
  return (
    <Dialog title={`Set up ${name}`} onClose={close} testid="local-setup"
      footer={retryable
        ? <><button type="button" className="btn" onClick={close}>Close</button><button type="button" className="btn primary" onClick={onRetry}>Try again</button></>
        : <Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={close} />}>
      <p className="aa-lede">{lede ?? defaultLede}</p>
      <WizardBody wizard={w} doneText={shownDone} errorText={shownError} />
    </Dialog>
  );
}
