// Set up a model on this computer: one branch.setup.prepare.start wizard session for the engine's setup option. The
// engine looks at this computer, says what it will download and install before it does, and reports its progress.
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { text, visible, type RecordValue } from "../adapter";
import { Footer, WizardBody } from "../AccountLogin";
import { useWizard } from "../use-wizard";

type Props = { engine: WindowEngine; option: RecordValue; agent: { agentId?: string }; onClose: () => void };

export function SetupDialog({ engine, option, agent, onClose }: Props) {
  const w = useWizard(engine, { method: "branch.setup.prepare.start", params: { authChoice: text(option.id), ...agent } });
  const name = visible(option.label);
  const close = () => { if (w.view.phase !== "done" && w.view.phase !== "error") w.cancel(); onClose(); };
  return (
    <Dialog title={`Set up ${name}`} onClose={close} testid="local-setup"
      footer={<Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={close} />}>
      <p className="aa-lede">Branch sets up {name} on this computer. It says what it will download and install before it does anything.</p>
      <WizardBody wizard={w} doneText={`${name} is set up on this computer. Free and private.`} />
    </Dialog>
  );
}
