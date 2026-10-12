// Preview spec-v23 index.html:8378 banner markup
import { Icon } from "./icons";

export function LockdownBanner({ onTurnOff }: { onTurnOff: () => void }) {
  return (
    <div className="lockdown-banner" role="status" data-testid="lockdown-banner">
      <Icon name="shield" size={16} />
      <span>Lockdown is on. Trunks can read, but nothing leaves this computer and nothing is changed.</span>
      <button type="button" onClick={onTurnOff}>Turn it off</button>
    </div>
  );
}
