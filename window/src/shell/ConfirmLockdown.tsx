import { Dialog } from "./Dialog";

export const LOCKDOWN_EXPLANATION = "Stops every Trunk from using tools until you turn this off";

/** clear: the R1 window's item 48 glass (README 48): a clear dialog with its words on frosted pills; the action stays solid. */
export function ConfirmLockdown({ busy, onCancel, onConfirm, clear }: { busy: boolean; onCancel: () => void; onConfirm: () => void; clear?: boolean }) {
  return <Dialog title="Turn Lockdown on?" onClose={onCancel} testid="confirm-lockdown" clear={clear} footer={<>
    <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    <button type="button" className="btn pri" data-solid="" disabled={busy} onClick={onConfirm}>{busy ? "Turning Lockdown on…" : "Turn Lockdown on"}</button>
  </>}>
    <p className={clear ? "dlg-p g-label" : "dlg-p"} data-lines={clear ? "" : undefined}>{LOCKDOWN_EXPLANATION}.</p>
  </Dialog>;
}
