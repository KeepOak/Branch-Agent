import type { OpenTarget } from "./nav";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS, openConnectModel } from "./connect-model";

/** The one control for “no usable model”: the same words everywhere, one primary button. */
export function ConnectModelNotice({ onOpen, onRetry, className }: {
  onOpen?: (target: OpenTarget) => void;
  onRetry?: () => void;
  className?: string;
}) {
  const go = () => {
    if (onOpen) onOpen("settings/accounts/add");
    else openConnectModel();
  };
  return (
    <div className={className} data-testid="connect-model">
      <p>{CONNECT_MODEL_ANSWERS}</p>
      <div className="connect-model-acts">
        <button type="button" className="btn pri sm" onClick={go}>{CONNECT_MODEL_ACTION}</button>
        {onRetry ? <button type="button" className="r1c-undo" onClick={onRetry}>Try again</button> : null}
      </div>
    </div>
  );
}
