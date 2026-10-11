import { Dialog } from "./Dialog";

export const LOCKDOWN_EXPLANATION = "Stops every Trunk from using tools until you turn this off";

export function ConfirmLockdown({ busy, onCancel, onConfirm }: { busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog title="Turn Lockdown on?" onClose={onCancel} testid="confirm-lockdown" footer={<>
    <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
    <button type="button" className="btn pri" disabled={busy} onClick={onConfirm}>{busy ? "Turning Lockdown on…" : "Turn Lockdown on"}</button>
  </>}>
    <p className="dlg-p">{LOCKDOWN_EXPLANATION}.</p>
  </Dialog>;
}
