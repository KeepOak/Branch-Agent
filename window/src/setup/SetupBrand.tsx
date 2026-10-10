// Setup is a logo place (DESIGN-SPEC §1.2 rule 3, §4.8.1 rule 3): the rail brand, the Welcome hero and the step poses.
// The poses are stills: Branch faces rest and move only on actions (owner rule), so nothing here loops.
import mail from "./art/branch-mail.webp";
import point from "./art/branch-point.webp";
import sleep from "./art/branch-sleep.webp";
import think from "./art/branch-think.webp";
import wave from "./art/branch-wave.webp";
import { KeeperMark } from "../brand/KeeperMark";
import work from "./art/branch-work.webp";
import yay from "./art/branch-yay.webp";

/** The step poses (§4.8.1 "Step performer"); Make it yours and Two more things have none. */
const POSES: Record<number, string> = { 1: point, 2: think, 4: work, 5: mail, 6: work, 7: sleep, 8: wave, 10: yay };

export function SetupBrand() {
  return (
    <span className="ob-brand">
      <KeeperMark size={26} />
      <span>Set up Branch</span>
    </span>
  );
}

export function WelcomeHero() {
  return (
    <div className="ob-stage11">
      <KeeperMark size={180} />
    </div>
  );
}

export function StepPose({ step }: { step: number }) {
  const src = POSES[step];
  return src ? <img className={`pose11 ob-pose11 ob-pose-step-${step}`} src={src} alt="" draggable={false} /> : null;
}
