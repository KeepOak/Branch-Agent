// Set up a model on this computer: one branch.setup.prepare.start wizard session for the engine's setup option. The
// engine looks at this computer, says what it will download and install before it does, and reports its progress.
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { text, visible, type RecordValue } from "../adapter";
import { Footer, WizardBody } from "../AccountLogin";
import { useWizard } from "../use-wizard";

type Props = { engine: WindowEngine; option: RecordValue; agent: { agentId?: string }; onClose: () => void; lede?: string; doneText?: string };

export function SetupDialog({ engine, option, agent, onClose, lede, doneText }: Props) {
  const w = useWizard(engine, { method: "branch.setup.prepare.start", params: { authChoice: text(option.id), ...agent } });
  const name = visible(option.label);
  const close = () => { if (w.view.phase !== "done" && w.view.phase !== "error") w.cancel(); onClose(); };
  const defaultLede = /ollama/i.test(text(option.id)) ? "Ollama runs models on this computer. Install Ollama if it isn’t already. A tools-capable model is about 9.6 GB; nothing downloads until you agree." : /llama-cpp|managed/i.test(text(option.id)) ? "Branch installs a local model on this computer. It tells you the download size (often a few GB) and asks before it starts." : /lmstudio/i.test(text(option.id)) ? "LM Studio runs models on this computer. Install LM Studio and load a model there first. Model files can be several GB." : `Branch sets up ${name} on this computer. It says what it will download and install, and how big it is, before it does anything.`;
  return (
    <Dialog title={`Set up ${name}`} onClose={close} testid="local-setup"
      footer={<Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={close} />}>
      <p className="aa-lede">{lede ?? defaultLede}</p>
      <WizardBody wizard={w} doneText={doneText ?? `${name} is set up on this computer. Free and private.`} />
    </Dialog>
  );
}
