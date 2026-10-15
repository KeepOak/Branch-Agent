// The What's new row in Settings › Updates & about (HANDOFF: one What's new dialog, and it lives here). It opens the
// window's What's new dialog through branch:whats-new, which both the Classic and the R1 window listen for.
import { Btn, Ctl } from "../kit";

export function WhatsNewRow() {
  return (
    <Ctl title="What’s new" sub="What this version brought, and what a waiting update adds.">
      <Btn sm onClick={() => window.dispatchEvent(new CustomEvent("branch:whats-new"))}>What’s new</Btn>
    </Ctl>
  );
}
