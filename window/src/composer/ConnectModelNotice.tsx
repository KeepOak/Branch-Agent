import type { OpenTarget } from "./nav";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS, openConnectModel } from "./connect-model";

/** The one control for “no usable model”: the same words everywhere, one button. */
export function ConnectModelNotice({ onOpen, className }: { onOpen?: (target: OpenTarget) => void; className?: string }) {
  const go = () => {
    if (onOpen) onOpen("settings/accounts/add");
    else openConnectModel();
  };
  return (
    <div className={className} data-testid="connect-model">
      <p>{CONNECT_MODEL_ANSWERS}</p>
      <button type="button" className="btn pri sm" onClick={go}>{CONNECT_MODEL_ACTION}</button>
    </div>
  );
}
